import { formatRetellError, RetellApiError, RetellClient } from "./api/retell";
import { resolveConfig } from "./config";
import { Emitter } from "./events";
import { renderMarkdown } from "./markdown";
import { SessionStore } from "./store";
import type { ChatMessage, OpenOptions, ResolvedConfig, WidgetConfig } from "./types";
import { chatIcon, closeIcon, resetIcon, sendIcon } from "./ui/icons";
import styles from "./styles.css?inline";

const HOST_ID = "retell-chat-widget-host";

function uid(): string {
  return `m_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

function resolveTheme(theme: ResolvedConfig["theme"]): "light" | "dark" {
  if (theme === "auto") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return theme;
}

function focusables(root: ParentNode): HTMLElement[] {
  return Array.from(
    root.querySelectorAll<HTMLElement>(
      'button:not([disabled]), textarea, input, [href], [tabindex]:not([tabindex="-1"])',
    ),
    ).filter((el) => !el.hasAttribute("hidden") && el.getClientRects().length > 0);
}

export class Widget {
  private config: ResolvedConfig;
  private store: SessionStore;
  private client: RetellClient;
  private events: Emitter;
  private shadow: ShadowRoot | null = null;
  private sending = false;
  private lastFailedText: string | null = null;
  private lastErrorDetail: string | null = null;
  private pendingContext = "";
  private mobileQuery: MediaQueryList | null = null;
  private removeTrigger?: () => void;
  private removeKeydown?: () => void;
  private removeResize?: () => void;
  private removeViewport?: () => void;
  private scrollLock: {
    y: number;
    htmlOverflow: string;
    htmlOverflowX: string;
    bodyOverflow: string;
    bodyOverflowX: string;
    bodyPosition: string;
    bodyTop: string;
    bodyLeft: string;
    bodyRight: string;
    bodyWidth: string;
  } | null = null;

  constructor(config: WidgetConfig, events: Emitter) {
    this.config = resolveConfig(config);
    this.events = events;
    this.store = new SessionStore(this.config.storageKey);
    this.client = new RetellClient(
      this.config.apiBase,
      this.config.publicKey,
      this.config.recaptchaKey,
    );
    const stored = this.store.get();
    this.pendingContext = stored.pendingContext || "";
    if (Object.keys(this.config.dynamicVariables).length) {
      this.store.patch({
        dynamicVariables: {
          ...stored.dynamicVariables,
          ...this.config.dynamicVariables,
        },
      });
    }
  }

  mount(): void {
    this.destroyDom();
    const host = document.createElement("div");
    host.id = HOST_ID;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = `<style>${styles}${this.config.customCss}</style>${this.shellHtml()}`;
    document.body.appendChild(host);
    this.shadow = shadow;
    this.applyTokens();
    this.bind();
    this.syncOpen(this.store.get().isOpen, { silent: true });
    this.renderMessages();
    this.updateComposer();
    this.refreshSessionStatus();
    this.handleDeepLink();
    this.events.emit("ready");
    if (this.config.autoOpen && !this.store.get().messages.length) {
      this.open();
    }
  }

  destroy(): void {
    this.removeTrigger?.();
    this.removeKeydown?.();
    this.removeResize?.();
    this.mobileQuery?.removeEventListener("change", this.onMobileChange);
    this.unbindViewport();
    this.unlockScroll();
    this.destroyDom();
  }

  open(options: OpenOptions = {}): void {
    if (options.dynamicVariables) {
      this.store.patch({
        dynamicVariables: {
          ...this.store.get().dynamicVariables,
          ...options.dynamicVariables,
        },
      });
    }
    if (options.context) {
      this.pendingContext = options.context;
      this.store.patch({ pendingContext: options.context });
    }
    if (options.draft != null) {
      this.store.patch({ draft: options.draft });
      this.updateComposer();
    }
    this.syncOpen(true);
    if (options.message) {
      void this.send(options.message);
    }
  }

  close(): void {
    this.syncOpen(false);
  }

  toggle(): void {
    if (this.store.get().isOpen) this.close();
    else this.open();
  }

  async send(text: string): Promise<void> {
    const content = text.trim();
    if (!content || this.sending) return;

    const userMessage: ChatMessage = {
      id: uid(),
      role: "user",
      content,
      createdAt: Date.now(),
    };
    this.store.patch({
      messages: [...this.store.get().messages, userMessage],
      draft: "",
    });
    this.lastFailedText = null;
    this.lastErrorDetail = null;
    this.sending = true;
    this.renderMessages();
    this.updateComposer();
    this.events.emit("message", userMessage);

    try {
      let chatId = await this.ensureChat();
      const apiContent = this.consumeContext(content);
      let completion;
      try {
        completion = await this.client.createChatCompletion(chatId, apiContent);
      } catch (error) {
        const ended = error instanceof RetellApiError && (error.status === 422 || error.status === 404);
        if (!ended) throw error;
        this.startFreshSession(true);
        chatId = await this.ensureChat();
        completion = await this.client.createChatCompletion(chatId, apiContent);
      }
      const agentMessages = (completion.messages || [])
        .filter((m) => m.role === "agent" && m.content)
        .map((m) => ({
          id: m.message_id || uid(),
          role: "agent" as const,
          content: m.content || "",
          createdAt: m.created_timestamp || Date.now(),
        }));

      if (agentMessages.length) {
        const unread = this.store.get().isOpen ? 0 : this.store.get().unreadCount + agentMessages.length;
        this.store.patch({
          messages: [...this.store.get().messages, ...agentMessages],
          unreadCount: unread,
        });
        for (const message of agentMessages) {
          this.events.emit("message", message);
        }
      }
    } catch (error) {
      console.error("[RetellChat] send failed", error);
      this.lastFailedText = content;
      this.lastErrorDetail = formatRetellError(error);
      this.store.patch({
        messages: this.store.get().messages.filter((m) => m.id !== userMessage.id),
        draft: content,
      });
      this.events.emit("error", {
        message: this.lastErrorDetail,
        status: error instanceof RetellApiError ? error.status : 0,
      });
    } finally {
      this.sending = false;
      this.renderMessages();
      this.updateComposer();
    }
  }

  reset(): void {
    this.store.reset(true);
    this.pendingContext = "";
    this.lastFailedText = null;
    this.lastErrorDetail = null;
    this.renderMessages();
    this.updateComposer();
    this.events.emit("reset");
  }

  private async ensureChat(): Promise<string> {
    const existing = this.store.get().chatId;
    if (existing) return existing;

    const created = await this.client.createChat({
      agentId: this.config.agentId,
      agentVersion: this.config.agentVersion,
      dynamicVariables: this.store.get().dynamicVariables,
    });
    this.store.patch({ chatId: created.chat_id });
    return created.chat_id;
  }

  private consumeContext(content: string): string {
    const context = this.pendingContext.trim();
    this.pendingContext = "";
    this.store.patch({ pendingContext: "" });
    if (!context) return content;
    return `[Kontext]\n${context}\n\n${content}`;
  }

  private startFreshSession(keepHistory: boolean): void {
    const messages = keepHistory
      ? [
          ...this.store.get().messages,
          {
            id: uid(),
            role: "divider" as const,
            content: this.config.strings.conversationEnded,
            createdAt: Date.now(),
          },
        ]
      : [];
    this.store.patch({ chatId: null, messages, unreadCount: 0 });
  }

  private async refreshSessionStatus(): Promise<void> {
    const chatId = this.store.get().chatId;
    if (!chatId) return;
    try {
      const chat = await this.client.getChat(chatId);
      if (chat.chat_status !== "ongoing") {
        this.startFreshSession(true);
        this.renderMessages();
      }
    } catch {
      // Public keys may not allow get-chat; keep local session.
    }
  }

  private syncOpen(isOpen: boolean, opts: { silent?: boolean } = {}): void {
    const wasOpen = this.store.get().isOpen;
    this.store.patch({
      isOpen,
      unreadCount: isOpen ? 0 : this.store.get().unreadCount,
    });
    const root = this.root();
    if (!root) return;
    root.dataset.open = String(isOpen);
    this.updateMobile();
    this.updateFab();
    if (isOpen) {
      this.lockScrollIfNeeded();
      queueMicrotask(() => this.focusComposer());
      this.scrollToBottom();
    } else {
      this.unlockScroll();
    }
    if (!opts.silent && wasOpen !== isOpen) {
      this.events.emit(isOpen ? "open" : "close");
    }
  }

  private shellHtml(): string {
    const { title, subtitle, strings, hideLauncher, fabText, position } = this.config;
    const theme = resolveTheme(this.config.theme);
    return `
      <div class="rcw" data-theme="${theme}" data-open="false" data-mobile="false" data-position="${position}" data-hide-launcher="${hideLauncher}">
        <button type="button" class="rcw-fab" aria-expanded="false" aria-controls="rcw-panel">
          <span class="rcw-fab-icon">${this.fabIconHtml()}</span>
          ${fabText ? `<span class="rcw-fab-label">${this.esc(fabText)}</span>` : `<span class="rcw-sr-only">${this.esc(strings.launcher)}</span>`}
          <span class="rcw-badge" hidden>0</span>
        </button>
        <section class="rcw-panel" id="rcw-panel" role="dialog" aria-modal="true" aria-labelledby="rcw-title">
          <header class="rcw-header">
            <div class="rcw-brand">
              <div class="rcw-avatar">${this.avatarHtml()}</div>
              <div class="rcw-titles">
                <h2 class="rcw-title" id="rcw-title">${this.esc(title)}</h2>
                ${subtitle ? `<p class="rcw-subtitle">${this.esc(subtitle)}</p>` : ""}
              </div>
            </div>
            <div class="rcw-header-actions">
              <button type="button" class="rcw-icon-btn rcw-reset" title="${this.esc(strings.newChat)}" aria-label="${this.esc(strings.newChat)}">${resetIcon}</button>
              <button type="button" class="rcw-icon-btn rcw-close" title="${this.esc(strings.close)}" aria-label="${this.esc(strings.close)}">${closeIcon}</button>
            </div>
          </header>
          <div class="rcw-messages" role="log" aria-live="polite"></div>
          <div class="rcw-quick" hidden></div>
          <form class="rcw-composer">
            <label class="rcw-sr-only" for="rcw-input">${this.esc(strings.placeholder)}</label>
            <textarea id="rcw-input" class="rcw-input" rows="1" placeholder="${this.esc(strings.placeholder)}"></textarea>
            <button type="submit" class="rcw-send" aria-label="${this.esc(strings.send)}">${sendIcon}</button>
          </form>
        </section>
      </div>
    `;
  }

  private bind(): void {
    const shadow = this.shadow;
    if (!shadow) return;

    shadow.querySelector(".rcw-fab")?.addEventListener("click", () => this.open());
    shadow.querySelector(".rcw-close")?.addEventListener("click", () => this.close());
    shadow.querySelector(".rcw-reset")?.addEventListener("click", () => this.reset());
    shadow.querySelector(".rcw-composer")?.addEventListener("submit", (event) => {
      event.preventDefault();
      const input = this.inputEl();
      void this.send(input?.value || "");
    });
    this.inputEl()?.addEventListener("input", () => {
      const value = this.inputEl()?.value || "";
      this.store.patch({ draft: value });
      this.autosize();
      this.updateComposer();
    });
    this.inputEl()?.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void this.send(this.inputEl()?.value || "");
      }
    });

    const onDocClick = (event: MouseEvent) => {
      const target = (event.target as Element | null)?.closest?.("[data-retell-open]");
      if (!target) return;
      event.preventDefault();
      const message = target.getAttribute("data-retell-message") || undefined;
      const draft = target.getAttribute("data-retell-draft") || undefined;
      const context = target.getAttribute("data-retell-context") || undefined;
      this.open({ message, draft, context });
    };
    document.addEventListener("click", onDocClick);
    this.removeTrigger = () => document.removeEventListener("click", onDocClick);

    const onKeydown = (event: KeyboardEvent) => {
      if (!this.store.get().isOpen) return;
      if (event.key === "Escape") {
        this.close();
        return;
      }
      if (event.key === "Tab") this.trapFocus(event);
    };
    document.addEventListener("keydown", onKeydown);
    this.removeKeydown = () => document.removeEventListener("keydown", onKeydown);

    this.mobileQuery = window.matchMedia(`(max-width: ${this.config.mobileBreakpoint}px)`);
    this.mobileQuery.addEventListener("change", this.onMobileChange);
    this.updateMobile();

    const onResize = () => this.updateMobile();
    window.addEventListener("resize", onResize);
    this.removeResize = () => window.removeEventListener("resize", onResize);
    this.bindViewport();
  }

  private onMobileChange = (): void => {
    this.updateMobile();
  };

  private handleDeepLink(): void {
    const params = new URLSearchParams(window.location.search);
    if (params.get("retell") !== "open") return;
    this.open({
      message: params.get("retell_q") || undefined,
      draft: params.get("retell_draft") || undefined,
    });
  }

  private renderMessages(): void {
    const list = this.shadow?.querySelector(".rcw-messages");
    if (!list) return;
    const session = this.store.get();
    const nodes: string[] = [];

    if (!session.messages.length && this.config.welcomeMessage) {
      nodes.push(this.messageRow({
        id: "welcome",
        role: "agent",
        content: this.config.welcomeMessage,
        createdAt: 0,
      }));
    } else if (!session.messages.length) {
      nodes.push(`<div class="rcw-empty">${this.esc(this.config.welcomeMessage || this.config.subtitle || this.config.title)}</div>`);
    }

    for (const message of session.messages) {
      if (message.role === "divider") {
        nodes.push(`<div class="rcw-divider">${this.esc(message.content)}</div>`);
      } else {
        nodes.push(this.messageRow(message));
      }
    }

    if (this.sending) {
      nodes.push(`
        <div class="rcw-row rcw-row-agent">
          <div class="rcw-msg-avatar">${this.avatarHtml()}</div>
          <div class="rcw-bubble rcw-typing">
            <span>${this.esc(this.config.strings.typing)}</span>
            <span class="rcw-dots"><span></span><span></span><span></span></span>
          </div>
        </div>
      `);
    }

    if (this.lastFailedText) {
      nodes.push(`
        <div class="rcw-error">
          <span>${this.esc(this.lastErrorDetail || this.config.strings.error)}</span>
          <button type="button" class="rcw-retry">${this.esc(this.config.strings.retry)}</button>
        </div>
      `);
    }

    list.innerHTML = nodes.join("");
    list.querySelector(".rcw-retry")?.addEventListener("click", () => {
      if (this.lastFailedText) void this.send(this.lastFailedText);
    });

    const quick = this.shadow?.querySelector<HTMLElement>(".rcw-quick");
    if (quick) {
      const showQuick = this.config.quickReplies.length > 0 && session.messages.length === 0 && !this.sending;
      quick.hidden = !showQuick;
      quick.innerHTML = showQuick
        ? this.config.quickReplies
            .map((reply) => `<button type="button" class="rcw-chip">${this.esc(reply)}</button>`)
            .join("")
        : "";
      quick.querySelectorAll<HTMLButtonElement>(".rcw-chip").forEach((chip) => {
        chip.addEventListener("click", () => void this.send(chip.textContent || ""));
      });
    }

    this.updateFab();
    this.scrollToBottom();
  }

  private messageRow(message: ChatMessage): string {
    const isUser = message.role === "user";
    const body = isUser ? this.esc(message.content).replace(/\n/g, "<br />") : renderMarkdown(message.content);
    return `
      <div class="rcw-row ${isUser ? "rcw-row-user" : "rcw-row-agent"}">
        ${isUser ? "" : `<div class="rcw-msg-avatar">${this.avatarHtml()}</div>`}
        <div class="rcw-bubble">${body || "&nbsp;"}</div>
      </div>
    `;
  }

  private updateComposer(): void {
    const input = this.inputEl();
    const send = this.shadow?.querySelector<HTMLButtonElement>(".rcw-send");
    if (input && input.value !== this.store.get().draft) {
      input.value = this.store.get().draft;
    }
    this.autosize();
    if (send) send.disabled = this.sending || !(input?.value.trim());
  }

  private updateFab(): void {
    const root = this.root();
    const fab = this.shadow?.querySelector<HTMLButtonElement>(".rcw-fab");
    const badge = this.shadow?.querySelector<HTMLElement>(".rcw-badge");
    if (!root || !fab || !badge) return;
    const unread = this.store.get().unreadCount;
    badge.hidden = unread <= 0 || this.store.get().isOpen;
    badge.textContent = unread > 9 ? "9+" : String(unread);
    fab.setAttribute("aria-expanded", String(this.store.get().isOpen));
  }

  private applyTokens(): void {
    const root = this.root();
    if (!root) return;
    const { colors, fontFamily, offsetX, offsetY, zIndex, panelWidth, panelHeight, borderRadius } = this.config;
    root.style.setProperty("--rcw-font", fontFamily);
    root.style.setProperty("--rcw-offset-x", `${offsetX}px`);
    root.style.setProperty("--rcw-offset-y", `${offsetY}px`);
    root.style.setProperty("--rcw-z", String(zIndex));
    root.style.setProperty("--rcw-panel-w", `${panelWidth}px`);
    root.style.setProperty("--rcw-panel-h", `${panelHeight}px`);
    root.style.setProperty("--rcw-radius", `${borderRadius}px`);
    if (colors.primary) root.style.setProperty("--rcw-primary", colors.primary);
    if (colors.background) root.style.setProperty("--rcw-bg", colors.background);
    if (colors.surface) root.style.setProperty("--rcw-surface", colors.surface);
    if (colors.userBubble) root.style.setProperty("--rcw-user", colors.userBubble);
    if (colors.agentBubble) root.style.setProperty("--rcw-agent", colors.agentBubble);
    if (colors.text) root.style.setProperty("--rcw-text", colors.text);
    if (colors.textMuted) root.style.setProperty("--rcw-muted", colors.textMuted);
    if (colors.border) root.style.setProperty("--rcw-border", colors.border);
  }

  private updateMobile(): void {
    const root = this.root();
    if (!root) return;
    root.dataset.mobile = String(this.isMobileLayout());
    if (this.store.get().isOpen) this.lockScrollIfNeeded();
    else this.unlockScroll();
    this.syncViewportBox();
  }

  private viewportWidth(): number {
    const visual = window.visualViewport?.width;
    return Math.min(window.innerWidth, Math.round(visual ?? window.innerWidth));
  }

  private isMobileLayout(): boolean {
    return this.viewportWidth() <= this.config.mobileBreakpoint;
  }

  private isMobileOpen(): boolean {
    return this.isMobileLayout() && this.store.get().isOpen;
  }

  private lockScrollIfNeeded(): void {
    if (!this.isMobileOpen()) {
      this.unlockScroll();
      return;
    }
    if (this.scrollLock) return;

    const html = document.documentElement;
    const body = document.body;
    this.scrollLock = {
      y: window.scrollY,
      htmlOverflow: html.style.overflow,
      htmlOverflowX: html.style.overflowX,
      bodyOverflow: body.style.overflow,
      bodyOverflowX: body.style.overflowX,
      bodyPosition: body.style.position,
      bodyTop: body.style.top,
      bodyLeft: body.style.left,
      bodyRight: body.style.right,
      bodyWidth: body.style.width,
    };
    html.style.overflow = "hidden";
    html.style.overflowX = "hidden";
    body.style.overflow = "hidden";
    body.style.overflowX = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${this.scrollLock.y}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
  }

  private unlockScroll(): void {
    this.clearViewportBox();
    const saved = this.scrollLock;
    this.scrollLock = null;
    if (!saved) return;

    const html = document.documentElement;
    const body = document.body;
    html.style.overflow = saved.htmlOverflow;
    html.style.overflowX = saved.htmlOverflowX;
    body.style.overflow = saved.bodyOverflow;
    body.style.overflowX = saved.bodyOverflowX;
    body.style.position = saved.bodyPosition;
    body.style.top = saved.bodyTop;
    body.style.left = saved.bodyLeft;
    body.style.right = saved.bodyRight;
    body.style.width = saved.bodyWidth;
    window.scrollTo(0, saved.y);
  }

  private bindViewport(): void {
    this.unbindViewport();
    const viewport = window.visualViewport;
    const onChange = () => this.syncViewportBox();
    viewport?.addEventListener("resize", onChange);
    viewport?.addEventListener("scroll", onChange);
    this.removeViewport = () => {
      viewport?.removeEventListener("resize", onChange);
      viewport?.removeEventListener("scroll", onChange);
    };
  }

  private unbindViewport(): void {
    this.removeViewport?.();
    this.removeViewport = undefined;
  }

  private syncViewportBox(): void {
    const panel = this.shadow?.querySelector<HTMLElement>(".rcw-panel");
    if (!panel) return;
    if (!this.isMobileOpen()) {
      this.clearViewportBox();
      return;
    }
    const viewport = window.visualViewport;
    const left = Math.round(viewport?.offsetLeft ?? 0);
    const top = Math.round(viewport?.offsetTop ?? 0);
    const width = Math.round(viewport?.width ?? window.innerWidth);
    const height = Math.round(viewport?.height ?? window.innerHeight);
    panel.style.position = "fixed";
    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
    panel.style.width = `${width}px`;
    panel.style.height = `${height}px`;
    panel.style.maxWidth = "none";
    panel.style.maxHeight = `${height}px`;
    panel.style.right = "auto";
    panel.style.bottom = "auto";
  }

  private clearViewportBox(): void {
    const panel = this.shadow?.querySelector<HTMLElement>(".rcw-panel");
    if (!panel) return;
    panel.style.position = "";
    panel.style.left = "";
    panel.style.top = "";
    panel.style.width = "";
    panel.style.height = "";
    panel.style.maxWidth = "";
    panel.style.maxHeight = "";
    panel.style.right = "";
    panel.style.bottom = "";
  }

  private trapFocus(event: KeyboardEvent): void {
    const panel = this.shadow?.querySelector(".rcw-panel");
    if (!panel) return;
    const items = focusables(panel);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    const active = this.shadow?.activeElement as HTMLElement | null;
    if (event.shiftKey && active === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  }

  private focusComposer(): void {
    this.inputEl()?.focus();
  }

  private scrollToBottom(): void {
    const list = this.shadow?.querySelector(".rcw-messages");
    if (list) list.scrollTop = list.scrollHeight;
  }

  private autosize(): void {
    const input = this.inputEl();
    if (!input) return;
    input.style.height = "auto";
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`;
  }

  private avatarHtml(): string {
    if (this.config.botAvatarUrl) {
      return `<img src="${this.esc(this.config.botAvatarUrl)}" alt="" />`;
    }
    return this.esc(initials(this.config.botName) || "AI");
  }

  private fabIconHtml(): string {
    if (this.config.fabIcon) {
      return `<img src="${this.esc(this.config.fabIcon)}" alt="" />`;
    }
    return chatIcon;
  }

  private inputEl(): HTMLTextAreaElement | null {
    return this.shadow?.querySelector("#rcw-input") ?? null;
  }

  private root(): HTMLElement | null {
    return this.shadow?.querySelector(".rcw") ?? null;
  }

  private esc(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  private destroyDom(): void {
    document.getElementById(HOST_ID)?.remove();
    this.shadow = null;
  }
}
