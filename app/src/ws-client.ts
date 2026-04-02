import type {
  PluginMessage,
  SessionMessage,
  StateMessage,
  SyncMessage,
} from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("ws-client");

export interface WSClientCallbacks {
  onSync: (msg: SyncMessage) => void;
  onState: (msg: StateMessage) => void;
  onSession: (msg: SessionMessage) => void;
  onConnected: () => void;
  onDisconnected: () => void;
}

export class AvatarWSClient {
  private ws: WebSocket | null = null;
  private readonly url: string;
  private readonly callbacks: WSClientCallbacks;
  private reconnectDelay = 1000;
  private readonly maxReconnectDelay = 30000;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private isIntentionallyClosed = false;

  constructor(url: string, callbacks: WSClientCallbacks) {
    this.url = url;
    this.callbacks = callbacks;
  }

  connect(): void {
    this.isIntentionallyClosed = false;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    this.attemptConnect();
  }

  disconnect(): void {
    this.isIntentionallyClosed = true;

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private attemptConnect(): void {
    if (this.isIntentionallyClosed) {
      return;
    }

    log.info("ws_connecting", { url: this.url });

    try {
      this.ws = new WebSocket(this.url);
    } catch (error) {
      log.error("ws_connect_error", { error: String(error) });
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      log.info("ws_connected");
      this.reconnectDelay = 1000;
      this.callbacks.onConnected();
    };

    this.ws.onmessage = (event) => {
      const message = this.parseMessage(event.data);
      if (!message) {
        return;
      }

      log.debug("ws_message", { type: message.type });

      switch (message.type) {
        case "sync":
          this.callbacks.onSync(message);
          return;
        case "state":
          this.callbacks.onState(message);
          return;
        case "session":
          this.callbacks.onSession(message);
          return;
        default:
          log.warn("ws_unknown_message", { type: (message as Record<string, unknown>).type });
      }
    };

    this.ws.onclose = () => {
      log.info("ws_disconnected");
      this.ws = null;
      this.callbacks.onDisconnected();

      if (!this.isIntentionallyClosed) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = (error) => {
      log.error("ws_error", { error: String(error) });
    };
  }

  private parseMessage(data: unknown): PluginMessage | null {
    try {
      const message = JSON.parse(String(data)) as PluginMessage;

      if (
        message &&
        typeof message === "object" &&
        "type" in message &&
        (message.type === "sync" || message.type === "state" || message.type === "session")
      ) {
        return message;
      }

      log.warn("ws_unknown_message", {
        type:
          message && typeof message === "object" && "type" in message
            ? String((message as Record<string, unknown>).type)
            : null,
      });
    } catch (error) {
      log.error("ws_parse_error", { error: String(error) });
    }

    return null;
  }

  private scheduleReconnect(): void {
    if (this.isIntentionallyClosed || this.reconnectTimer) {
      return;
    }

    const delay = this.reconnectDelay;
    log.info("ws_reconnect_scheduled", { delay });

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.attemptConnect();
    }, delay);

    this.reconnectDelay = Math.min(delay * 2, this.maxReconnectDelay);
  }
}
