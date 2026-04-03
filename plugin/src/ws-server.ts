import { WebSocket, WebSocketServer } from "ws";
import type {
  AppMessage,
  CommandResult,
  PluginMessage,
  SessionInfo,
  SyncMessage,
} from "@opencode-avatar/shared";
import { createLogger } from "./logger.js";

const log = createLogger("ws-server");

type CommandInput =
  | AppMessage
  | {
    type: "command";
    command: string;
    sessionId: string;
    requestId: string;
    [key: string]: unknown;
  };

type MessageHandler = (message: CommandInput, reply: (result: CommandResult) => void) => void;

export class AvatarWSServer {
  private wss: WebSocketServer | null = null;
  private startingServer: WebSocketServer | null = null;
  private startPromise: Promise<void> | null = null;
  private stopPromise: Promise<void> | null = null;
  private readonly clients = new Set<WebSocket>();
  private syncData: SessionInfo[] = [];
  private readonly port: number;
  private actualPort = 0;
  private messageHandler: MessageHandler | null = null;

  constructor(port = 2728) {
    this.port = port;
  }

  async start(): Promise<void> {
    if (this.wss) {
      return;
    }

    if (this.stopPromise) {
      await this.stopPromise;
    }

    if (this.wss) {
      return;
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = new Promise<void>((resolve, reject) => {
      const wss = new WebSocketServer({ port: this.port });
      this.startingServer = wss;
      let settled = false;

      const resolveOnce = () => {
        if (settled) {
          return;
        }

        settled = true;

        if (this.startingServer !== wss) {
          this.startPromise = null;
          resolve();
          return;
        }

        const address = wss.address();
        this.actualPort = typeof address === "object" && address ? address.port : this.port;
        this.wss = wss;
        this.startingServer = null;
        this.startPromise = null;
        log.info("ws_server_started", { port: this.actualPort });
        resolve();
      };

      const rejectOnce = (error: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.startingServer === wss) {
          this.startingServer = null;
        }
        this.startPromise = null;
        log.error("ws_server_error", { error: error.message });
        reject(error);
      };

      const settleClosedStart = () => {
        if (settled) {
          return;
        }

        settled = true;
        if (this.startingServer === wss) {
          this.startingServer = null;
        }
        this.startPromise = null;
        resolve();
      };

      wss.once("listening", resolveOnce);
      wss.once("error", rejectOnce);
      wss.once("close", settleClosedStart);
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

        ws.on("message", (data) => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(data.toString());
          } catch (error) {
            log.warn("ws_message_parse_failed", { error: error instanceof Error ? error.message : String(error) });
            return;
          }

          if (!this.isCommandInput(parsed)) {
            const type = parsed && typeof parsed === "object" && "type" in parsed
              ? String((parsed as Record<string, unknown>).type)
              : null;
            log.warn("ws_message_ignored", { type });
            return;
          }

          log.info("ws_message_received", {
            command: parsed.command,
            requestId: parsed.requestId,
            sessionId: parsed.sessionId,
          });

          if (!this.messageHandler) {
            log.warn("ws_message_handler_missing", {
              command: parsed.command,
              requestId: parsed.requestId,
              sessionId: parsed.sessionId,
            });
            return;
          }

          this.messageHandler(parsed, (result) => {
            if (ws.readyState !== WebSocket.OPEN) {
              log.warn("ws_reply_socket_closed", {
                requestId: result.requestId,
              });
              return;
            }

            ws.send(JSON.stringify(result));
            log.info("ws_reply_sent", {
              requestId: result.requestId,
              success: result.success,
            });
          });
        });
      });
    });

    return this.startPromise;
  }

  async stop(): Promise<void> {
    if (this.stopPromise) {
      return this.stopPromise;
    }

    const wss = this.wss ?? this.startingServer;
    this.wss = null;
    this.startingServer = null;
    this.actualPort = 0;

    for (const client of this.clients) {
      client.close();
    }
    this.clients.clear();

    if (!wss) {
      this.startPromise = null;
      return;
    }

    this.stopPromise = new Promise<void>((resolve) => {
      wss.close(() => {
        this.startPromise = null;
        this.stopPromise = null;
        log.info("ws_server_stopped");
        resolve();
      });
    });

    return this.stopPromise;
  }

  getPort(): number {
    return this.actualPort;
  }

  setSyncData(sessions: SessionInfo[]): void {
    this.syncData = sessions;
  }

  setMessageHandler(handler: MessageHandler): void {
    this.messageHandler = handler;
  }

  broadcastSync(): void {
    const message: SyncMessage = {
      type: "sync",
      sessions: this.syncData,
    };

    this.broadcast(message);
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

  private isCommandInput(value: unknown): value is CommandInput {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      candidate.type === "command" &&
      typeof candidate.command === "string" &&
      typeof candidate.sessionId === "string" &&
      typeof candidate.requestId === "string"
    );
  }
}
