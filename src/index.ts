import { configFromScript, findEmbedScript } from "./config";
import { Emitter } from "./events";
import type { OpenOptions, RetellChatAPI, WidgetConfig } from "./types";
import { Widget } from "./widget";

const events = new Emitter();
let widget: Widget | null = null;
const queue: Array<() => void> = [];

function runOrQueue(fn: (instance: Widget) => void): void {
  if (widget) {
    fn(widget);
    return;
  }
  queue.push(() => {
    if (widget) fn(widget);
  });
}

function flushQueue(): void {
  while (queue.length) {
    queue.shift()?.();
  }
}

const api: RetellChatAPI = {
  init(config: WidgetConfig) {
    if (!config?.publicKey || !config?.agentId) {
      console.error("[RetellChat] publicKey and agentId are required");
      return;
    }
    const start = () => {
      widget?.destroy();
      widget = new Widget(config, events);
      widget.mount();
      flushQueue();
    };
    if (!document.body) {
      document.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    start();
  },
  destroy() {
    widget?.destroy();
    widget = null;
  },
  open(options?: OpenOptions) {
    runOrQueue((instance) => instance.open(options));
  },
  close() {
    runOrQueue((instance) => instance.close());
  },
  toggle() {
    runOrQueue((instance) => instance.toggle());
  },
  send(text: string) {
    if (!widget) {
      return new Promise<void>((resolve, reject) => {
        queue.push(() => {
          widget?.send(text).then(resolve, reject);
        });
      });
    }
    return widget.send(text);
  },
  reset() {
    runOrQueue((instance) => instance.reset());
  },
  on(event, handler) {
    return events.on(event, handler);
  },
};

window.RetellChat = api;

function autoInit(): void {
  if (widget) return;
  const script = findEmbedScript();
  if (!script) return;
  const config = configFromScript(script);
  if (config) api.init(config);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", autoInit, { once: true });
} else {
  autoInit();
}

export default api;
