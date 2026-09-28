import { defaultStrings } from "./i18n";
import type { QuickReply, QuickReplyInput, ResolvedConfig, Theme, WidgetConfig, WidgetStrings } from "./types";

const DEFAULT_API_BASE = "https://api.retellai.com";

export function resolveConfig(config: WidgetConfig): ResolvedConfig {
  const primary = config.colors?.primary;
  const strings: WidgetStrings = {
    ...defaultStrings,
    ...config.strings,
  };
  if (config.placeholder) strings.placeholder = config.placeholder;
  const fabText =
    config.fabText ?? config.buttonText ?? strings.launcher;
  if (fabText) strings.launcher = fabText;

  return {
    publicKey: config.publicKey,
    agentId: config.agentId,
    agentVersion: config.agentVersion,
    apiBase: (config.apiBase || DEFAULT_API_BASE).replace(/\/$/, ""),
    title: config.title || "Chat",
    subtitle: config.subtitle || "",
    logoUrl: config.logoUrl || "",
    botAvatarUrl: config.botAvatarUrl || config.logoUrl || "",
    botName: config.botName || "Assistent",
    fabText,
    fabIcon: config.fabIcon || "",
    hideLauncher: Boolean(config.hideLauncher),
    welcomeMessage: config.welcomeMessage || "",
    emptyText: config.emptyText || "",
    quickReplies: normalizeQuickReplies(config.quickReplies),
    position: config.position === "bottom-left" ? "bottom-left" : "bottom-right",
    offsetX: config.offsetX ?? 20,
    offsetY: config.offsetY ?? 20,
    zIndex: config.zIndex ?? 2147483000,
    panelWidth: config.panelWidth ?? 380,
    panelHeight: config.panelHeight ?? 640,
    borderRadius: config.borderRadius ?? 20,
    fontFamily:
      config.fontFamily ||
      'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
    theme: (config.theme || "light") as Theme,
    colors: {
      primary,
      ...config.colors,
    },
    customCss: config.customCss || "",
    mobileBreakpoint: config.mobileBreakpoint ?? 640,
    storageKey: config.storageKey || config.agentId,
    dynamicVariables: config.dynamicVariables || {},
    recaptchaKey: config.recaptchaKey || "",
    strings,
    autoOpen: Boolean(config.autoOpen),
  };
}

function boolAttr(value: string | null): boolean {
  if (!value) return false;
  return value === "true" || value === "1" || value === "";
}

function numAttr(value: string | null | undefined): number | undefined {
  if (value == null || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function stringVars(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const out: Record<string, string> = {};
  for (const [key, val] of Object.entries(value)) {
    if (val == null) continue;
    out[key] = String(val);
  }
  return Object.keys(out).length ? out : undefined;
}

function normalizeQuickReplies(input?: QuickReplyInput[]): QuickReply[] {
  if (!input) return [];
  const out: QuickReply[] = [];
  for (const item of input) {
    if (typeof item === "string") {
      const text = item.trim();
      if (text) out.push({ label: text, message: text });
      continue;
    }
    if (!item || typeof item !== "object") continue;
    const label = String(item.label || "").trim();
    const message = String(item.message || "").trim();
    if (!label || !message) continue;
    const dynamicVariables = stringVars(item.dynamicVariables);
    out.push(dynamicVariables ? { label, message, dynamicVariables } : { label, message });
  }
  return out;
}

function quickRepliesFromAttr(value: string | undefined): QuickReplyInput[] | undefined {
  if (!value) return undefined;
  const parsed = jsonAttr<unknown>(value);
  if (Array.isArray(parsed)) return parsed as QuickReplyInput[];
  return value.split("|").map((part) => part.trim()).filter(Boolean);
}

function jsonAttr<T>(value: string | null | undefined): T | undefined {
  if (!value) return undefined;
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}

export function configFromScript(script: HTMLScriptElement): WidgetConfig | null {
  const dataset = script.dataset;
  const publicKey = dataset.publicKey || "";
  const agentId = dataset.agentId || "";
  if (!publicKey || !agentId) return null;

  const quickReplies = quickRepliesFromAttr(dataset.quickReplies);

  const primary = dataset.color || dataset.primary || dataset.componentColor;
  const background = dataset.themeColor || dataset.background;

  return {
    publicKey,
    agentId,
    agentVersion: dataset.agentVersion || numAttr(dataset.agentVersion ?? null),
    apiBase: dataset.apiBase,
    title: dataset.title,
    subtitle: dataset.subtitle,
    logoUrl: dataset.logoUrl,
    botAvatarUrl: dataset.botAvatarUrl,
    botName: dataset.botName,
    fabText: dataset.fabText ?? dataset.buttonText,
    fabIcon: dataset.fabIcon,
    hideLauncher: boolAttr(dataset.hideLauncher ?? null),
    welcomeMessage: dataset.welcomeMessage,
    emptyText: dataset.emptyText,
    quickReplies,
    placeholder: dataset.placeholder,
    position: dataset.position === "bottom-left" ? "bottom-left" : "bottom-right",
    offsetX: numAttr(dataset.offsetX ?? null),
    offsetY: numAttr(dataset.offsetY ?? null),
    zIndex: numAttr(dataset.zIndex ?? null),
    panelWidth: numAttr(dataset.panelWidth ?? null),
    panelHeight: numAttr(dataset.panelHeight ?? null),
    borderRadius: numAttr(dataset.borderRadius ?? null),
    fontFamily: dataset.fontFamily,
    theme: (dataset.theme as WidgetConfig["theme"]) || undefined,
    colors: {
      primary,
      background,
      surface: dataset.surface,
      userBubble: dataset.userBubble,
      agentBubble: dataset.agentBubble,
      text: dataset.textColor,
      textMuted: dataset.textMuted,
      border: dataset.borderColor,
    },
    customCss: dataset.customCss,
    mobileBreakpoint: numAttr(dataset.mobileBreakpoint ?? null),
    storageKey: dataset.storageKey,
    dynamicVariables: jsonAttr<Record<string, string>>(dataset.dynamic ?? null),
    recaptchaKey: dataset.recaptchaKey,
    autoOpen: boolAttr(dataset.autoOpen ?? null),
  };
}

export function findEmbedScript(): HTMLScriptElement | null {
  if (document.currentScript instanceof HTMLScriptElement) {
    return document.currentScript;
  }
  return (
    document.querySelector<HTMLScriptElement>("script[data-public-key][data-agent-id]") ||
    document.querySelector<HTMLScriptElement>('script[src*="retell-chat-widget"]')
  );
}
