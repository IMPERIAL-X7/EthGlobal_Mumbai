import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type { Deps } from "./deps.ts";
import { ownerFromSessionToken } from "./services/auth.ts";
import { SESSION_COOKIE } from "./http.ts";

function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
}

/**
 * Socket.IO: server -> client push only.
 *  - authenticates with the same httpOnly session cookie as REST
 *  - every socket joins `owner:<id>` automatically (all of the owner's agents)
 *  - client may narrow with emit("subscribe", { agentId }) -> joins `agent:<id>`
 */
export function attachSockets(httpServer: HttpServer, d: Deps) {
  const io = new Server(httpServer, { cors: { origin: d.cfg.WEB_ORIGIN, credentials: true }, path: "/socket.io" });

  io.use((socket, next) => {
    const owner = ownerFromSessionToken(d, readCookie(socket.handshake.headers.cookie, SESSION_COOKIE));
    if (!owner) return next(new Error("unauthenticated"));
    socket.data.ownerId = owner.id;
    next();
  });

  io.on("connection", (socket) => {
    const ownerId = socket.data.ownerId as string;
    socket.join(`owner:${ownerId}`);
    socket.on("subscribe", (msg: { agentId?: string }, ack?: (r: unknown) => void) => {
      const a = d.db.prepare(`SELECT owner_id FROM agents WHERE id = ?`).get(msg?.agentId ?? "") as { owner_id: string } | undefined;
      if (!a || a.owner_id !== ownerId) return ack?.({ ok: false, error: "not found" });
      socket.join(`agent:${msg.agentId}`);
      ack?.({ ok: true });
    });
    socket.on("unsubscribe", (msg: { agentId?: string }) => socket.leave(`agent:${msg?.agentId}`));
  });

  const off = d.bus.onAny(({ event, payload, ownerId }) => {
    io.to(`owner:${ownerId}`).emit(event, payload);
  });
  return { io, close: () => (off(), io.close()) };
}
