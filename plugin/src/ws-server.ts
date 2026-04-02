import { WebSocket, WebSocketServer } from "ws";
import type {
  PluginMessage,
  SessionInfo,
  SyncMessage,
} from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("ws-server");

export class AvatarWSServer {
  private wss: WebSocketServer | null = null;
  private readonly clients = new Set<WebSocket>();
  private syncData: SessionInfo[] = [];
  private readonly port: number;
  private actualPort = 0;

  constructor(port = 2728) {
    this.port = port;
  }

  async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.port });
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }

        settled = true;
        const address = wss.address();
        this.actualPort = typeof address === "object" && address ? address.port : this.port;
        this.wss = wss;
        log.info("ws_server_started", { port: this.actualPort });
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        log.error("ws_server_error", { error: error.message });
        reject(error);
      };

      wss.once("listening", resolveOnce);
      wss.once("error", rejectOnce);
      wss.on("connection", (ws) => {
        this.clients.add(ws);
        log.info("ws_client_connected", { clients: this.clients.size });

        const syncMessage: SyncMessage = {
          type: "sync",
          sessions: this.syncData,
        };
        ws.send(JSON.stringify(syncMessage));

        ws.on("close", () => {
          this.clients.delete(ws);
          log.info("ws_client_disconnected", { clients: this.clients.size });
        });

        ws.on("error", (error) => {
          this.clients.delete(ws);
          log.warn("ws_client_error", { error: error.message });
        });
      });
    });
  }

  async stop(): Promise<void> {
    const wss = this.wss;
    this.wss = null;
    this.actualPort = 0;

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (!wss) {
      return;
    }

    await new Promise<void>((resolve) => {
      wss.close(() => {
        log.info("ws_server_stopped");
        resolve();
      });
    });
  }

  getPort(): number {
    return this.actualPort;
  }

  setSyncData(sessions: SessionInfo[]): void {
    this.syncData = sessions;
  }

  broadcast(message: PluginMessage): void {
    const payload = JSON.stringify(message);

    log.debug("ws_broadcast", { type: message.type, clients: this.clients.size });

    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(payload);
      }
    }
  }
}
