import type {
  ChatCompletionResponse,
  CreateChatResponse,
  GetChatResponse,
} from "../types";

export class RetellApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, message: string, body = "") {
    super(message);
    this.name = "RetellApiError";
    this.status = status;
    this.body = body;
  }
}

export function formatRetellError(error: unknown): string {
  if (error instanceof RetellApiError) {
    const msg = error.message.toLowerCase();
    if (error.status === 401 || error.status === 403) {
      return "Public Key ungültig oder Domain nicht erlaubt. Trage localhost bzw. deine Domain beim Key ein.";
    }
    if (error.status === 402) {
      return "Retell-Konto: Zahlung oder Trial abgelaufen.";
    }
    if (error.status === 429) {
      return "Zu viele Anfragen. Bitte kurz warten.";
    }
    if (msg.includes("recaptcha") || msg.includes("captcha")) {
      return "reCAPTCHA fehlt oder ist ungültig. Site-Key im Widget setzen und Script einbinden.";
    }
    if (error.message && error.message !== `Retell API error ${error.status}`) {
      return error.message;
    }
    return `Retell-Fehler ${error.status}`;
  }
  if (error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))) {
    return "Netzwerkfehler (oft CORS). Domain beim Public Key erlauben oder apiBase auf einen Proxy setzen.";
  }
  if (error instanceof Error && error.message) return error.message;
  return "Nachricht konnte nicht gesendet werden.";
}

async function getRecaptchaToken(siteKey: string): Promise<string | undefined> {
  const grecaptcha = window.grecaptcha;
  if (!siteKey) return undefined;
  if (!grecaptcha) {
    throw new RetellApiError(
      0,
      "reCAPTCHA fehlt oder ist ungültig. Site-Key im Widget setzen und Script einbinden.",
    );
  }
  await new Promise<void>((resolve) => {
    grecaptcha.ready(() => resolve());
  });
  try {
    return await grecaptcha.execute(siteKey, { action: "chat" });
  } catch {
    throw new RetellApiError(
      0,
      "reCAPTCHA fehlt oder ist ungültig. Site-Key im Widget setzen und Script einbinden.",
    );
  }
}

function parseErrorMessage(text: string, status: number): string {
  if (!text) return `Retell API error ${status}`;
  try {
    const json = JSON.parse(text) as { message?: string; error?: string };
    return json.message || json.error || text;
  } catch {
    return text;
  }
}

export class RetellClient {
  constructor(
    private apiBase: string,
    private publicKey: string,
    private recaptchaKey = "",
  ) {}

  async createChat(input: {
    agentId: string;
    agentVersion?: string | number;
    dynamicVariables?: Record<string, string>;
  }): Promise<CreateChatResponse> {
    const recaptchaToken = await getRecaptchaToken(this.recaptchaKey);
    const body: Record<string, unknown> = {
      agent_id: input.agentId,
    };
    const versionNum = Number(input.agentVersion);
    if (input.agentVersion !== undefined && input.agentVersion !== "" && !Number.isNaN(versionNum)) {
      body.agent_version = versionNum;
    }
    if (input.dynamicVariables && Object.keys(input.dynamicVariables).length) {
      body.retell_llm_dynamic_variables = input.dynamicVariables;
    }

    const created = await this.request<CreateChatResponse>("/create-chat", {
      method: "POST",
      body,
      recaptchaToken,
    });
    if (!created?.chat_id) {
      throw new RetellApiError(0, "Retell hat keine chat_id zurückgegeben.", JSON.stringify(created));
    }
    return created;
  }

  async createChatCompletion(chatId: string, content: string): Promise<ChatCompletionResponse> {
    return this.request<ChatCompletionResponse>("/create-chat-completion", {
      method: "POST",
      body: { chat_id: chatId, content },
    });
  }

  async getChat(chatId: string): Promise<GetChatResponse> {
    return this.request<GetChatResponse>(`/get-chat/${encodeURIComponent(chatId)}`, {
      method: "GET",
    });
  }

  private async request<T>(
    path: string,
    options: {
      method: "GET" | "POST";
      body?: Record<string, unknown>;
      recaptchaToken?: string;
    },
  ): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.publicKey}`,
    };
    if (options.recaptchaToken) {
      headers["g-recaptcha-response"] = options.recaptchaToken;
    }

    let response: Response;
    try {
      response = await fetch(`${this.apiBase}${path}`, {
        method: options.method,
        headers,
        body: options.body ? JSON.stringify(options.body) : undefined,
      });
    } catch (error) {
      throw error instanceof Error ? error : new TypeError("Failed to fetch");
    }

    const text = await response.text();
    if (!response.ok) {
      throw new RetellApiError(response.status, parseErrorMessage(text, response.status), text);
    }
    if (!text) return {} as T;
    return JSON.parse(text) as T;
  }
}
