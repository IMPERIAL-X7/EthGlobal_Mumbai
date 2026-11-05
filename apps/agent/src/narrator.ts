import { EventEmitter } from "node:events";

export type Side = "legacy" | "leash";
export type NarrationKind = "thought" | "action" | "result" | "blocked" | "waiting" | "error" | "done" | "info";
export interface Narration {
  at: number;
  side: Side;
  kind: NarrationKind;
  text: string;
  data?: unknown;
}

/** Everything the demo agent "thinks" and does, streamed to the split-screen UI over SSE. */
export class Narrator {
  private ee = new EventEmitter();
  readonly history: Narration[] = [];
  say(side: Side, kind: NarrationKind, text: string, data?: unknown) {
    const n = { at: Date.now(), side, kind, text, data };
    this.history.push(n);
    if (this.history.length > 500) this.history.shift();
    this.ee.emit("n", n);
    const icon = { thought: "💭", action: "▶", result: "✓", blocked: "⛔", waiting: "⏳", error: "✗", done: "🏁", info: "ℹ" }[kind];
    console.log(`[${side}] ${icon} ${text}`);
  }
  on(fn: (n: Narration) => void) {
    this.ee.on("n", fn);
    return () => this.ee.off("n", fn);
  }
  clear() {
    this.history.length = 0;
  }
}
