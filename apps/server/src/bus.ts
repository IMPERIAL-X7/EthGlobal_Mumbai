import { EventEmitter } from "node:events";
import type { ServerEventName, ServerEvents } from "@leash/shared";

/** Typed in-process event bus. Socket.IO and long-poll waiters subscribe to it. */
export class Bus {
  private ee = new EventEmitter();
  constructor() {
    this.ee.setMaxListeners(1000);
  }
  emit<E extends ServerEventName>(event: E, payload: ServerEvents[E], ownerId: string): void {
    this.ee.emit("*", { event, payload, ownerId });
    this.ee.emit(event, payload);
  }
  onAny(fn: (m: { event: ServerEventName; payload: any; ownerId: string }) => void) {
    this.ee.on("*", fn);
    return () => this.ee.off("*", fn);
  }
  on<E extends ServerEventName>(event: E, fn: (p: ServerEvents[E]) => void) {
    this.ee.on(event, fn);
    return () => this.ee.off(event, fn);
  }
}
