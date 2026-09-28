export type Theme = "light" | "dark" | "auto";
export type Position = "bottom-right" | "bottom-left";
export type WidgetEvent = "ready" | "open" | "close" | "message" | "error" | "reset";

export interface WidgetStrings {
  placeholder: string;
  send: string;
  newChat: string;
  typing: string;
  error: string;
  retry: string;
  close: string;
  launcher: string;
  conversationEnded: string;
}

export interface QuickReply {
  label: string;
  message: string;
  dynamicVariables?: Record<string, string>;
}

export type QuickReplyInput =
  | string
  | { label: string; message: string; dynamicVariables?: Record<string, unknown> };

export interface WidgetColors {
  primary?: string;
  background?: string;
  surface?: string;
  userBubble?: string;
  agentBubble?: string;
  text?: string;
  textMuted?: string;
  border?: string;
}

export interface WidgetConfig {
  publicKey: string;
  agentId: string;
  agentVersion?: string | number;
  apiBase?: string;
  title?: string;
  subtitle?: string;
  logoUrl?: string;
  botAvatarUrl?: string;
  botName?: string;
  fabText?: string;
  buttonText?: string;
  fabIcon?: string;
  hideLauncher?: boolean;
  welcomeMessage?: string;
  emptyText?: string;
  quickReplies?: QuickReplyInput[];
  placeholder?: string;
  position?: Position;
  offsetX?: number;
  offsetY?: number;
  zIndex?: number;
  panelWidth?: number;
  panelHeight?: number;
  borderRadius?: number;
  fontFamily?: string;
  theme?: Theme;
  colors?: WidgetColors;
  customCss?: string;
  mobileBreakpoint?: number;
  storageKey?: string;
  dynamicVariables?: Record<string, string>;
  recaptchaKey?: string;
  strings?: Partial<WidgetStrings>;
  autoOpen?: boolean;
}

export interface ResolvedConfig {
  publicKey: string;
  agentId: string;
  agentVersion?: string | number;
  apiBase: string;
  title: string;
  subtitle: string;
  logoUrl: string;
  botAvatarUrl: string;
  botName: string;
  fabText: string;
  fabIcon: string;
  hideLauncher: boolean;
  welcomeMessage: string;
  emptyText: string;
  quickReplies: QuickReply[];
  position: Position;
  offsetX: number;
  offsetY: number;
  zIndex: number;
  panelWidth: number;
  panelHeight: number;
  borderRadius: number;
  fontFamily: string;
  theme: Theme;
  colors: WidgetColors;
  customCss: string;
  mobileBreakpoint: number;
  storageKey: string;
  dynamicVariables: Record<string, string>;
  recaptchaKey: string;
  strings: WidgetStrings;
  autoOpen: boolean;
}

export interface OpenOptions {
  draft?: string;
  message?: string;
  dynamicVariables?: Record<string, string>;
  context?: string;
  start?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "agent" | "divider";
  content: string;
  createdAt: number;
}

export interface StoredSession {
  chatId: string | null;
  messages: ChatMessage[];
  isOpen: boolean;
  draft: string;
  unreadCount: number;
  dynamicVariables: Record<string, string>;
  pendingContext: string;
  updatedAt: number;
}

export type EventHandler = (payload?: unknown) => void;

export interface RetellChatAPI {
  init(config: WidgetConfig): void;
  destroy(): void;
  open(options?: OpenOptions): void;
  close(): void;
  toggle(): void;
  send(text: string): Promise<void>;
  reset(): void;
  on(event: WidgetEvent, handler: EventHandler): () => void;
}

export interface CreateChatResponse {
  chat_id: string;
  agent_id: string;
  chat_status: "ongoing" | "ended" | "error";
  message_with_tool_calls?: ChatCompletionResponse["messages"];
}

export interface ChatCompletionResponse {
  messages: Array<{
    role?: string;
    content?: string;
    message_id?: string;
    created_timestamp?: number;
  }>;
}

export interface GetChatResponse {
  chat_id: string;
  chat_status: "ongoing" | "ended" | "error";
  message_with_tool_calls?: ChatCompletionResponse["messages"];
}

declare global {
  interface Window {
    RetellChat: RetellChatAPI;
    grecaptcha?: {
      ready: (cb: () => void) => void;
      execute: (siteKey: string, options: { action: string }) => Promise<string>;
    };
  }
}
