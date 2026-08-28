import type { EventHandler, WidgetEvent } from "./types";

export class Emitter {
  private listeners = new Map<WidgetEvent, Set<EventHandler>>();

  on(event: WidgetEvent, handler: EventHandler): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(handler);
    return () => set.delete(handler);
  }

  emit(event: WidgetEvent, payload?: unknown): void {
    const set = this.listeners.get(event);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(payload);
      } catch (error) {
        console.error("[RetellChat] event handler failed", error);
      }
    }
  }

  clear(): void {
    this.listeners.clear();
  }
}
