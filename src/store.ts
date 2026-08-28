import type { StoredSession } from "./types";

const PREFIX = "retell-chat-widget";

function emptySession(): StoredSession {
  return {
    chatId: null,
    messages: [],
    isOpen: false,
    draft: "",
    unreadCount: 0,
    dynamicVariables: {},
    pendingContext: "",
    updatedAt: Date.now(),
  };
}

export function storageKeyFor(id: string): string {
  return `${PREFIX}:${id}`;
}

export class SessionStore {
  private key: string;
  private session: StoredSession;

  constructor(storageKey: string) {
    this.key = storageKeyFor(storageKey);
    this.session = this.read() ?? emptySession();
  }

  get(): StoredSession {
    return this.session;
  }

  patch(partial: Partial<StoredSession>): StoredSession {
    this.session = {
      ...this.session,
      ...partial,
      updatedAt: Date.now(),
    };
    this.write();
    return this.session;
  }

  reset(keepOpen = false): StoredSession {
    this.session = {
      ...emptySession(),
      isOpen: keepOpen ? this.session.isOpen : false,
    };
    this.write();
    return this.session;
  }

  private read(): StoredSession | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as StoredSession;
      if (!parsed || !Array.isArray(parsed.messages)) return null;
      return {
        ...emptySession(),
        ...parsed,
        messages: parsed.messages.filter(
          (m) => m && (m.role === "user" || m.role === "agent" || m.role === "divider"),
        ),
      };
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.session));
    } catch (error) {
      console.warn("[RetellChat] could not persist session", error);
    }
  }
}
