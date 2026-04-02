import { afterEach, beforeEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type {
  PluginMessage,
  StateMessage,
  SyncMessage,
} from "@opencode-avatar/shared/src/protocol.js";
import { AvatarWSServer } from "../src/ws-server.js";

describe("AvatarWSServer", () => {
  let server: AvatarWSServer;

  beforeEach(async () => {
    server = new AvatarWSServer(0);
    await server.start();
  });

  afterEach(async () => {
    await server.stop();
  });

  function connect(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${server.getPort()}`);
      ws.once("open", () => resolve(ws));
      ws.once("error", reject);
    });
  }

  function connectWithFirstMessage(port = server.getPort()): Promise<{
    ws: WebSocket;
    message: PluginMessage;
  }> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);

      ws.once("message", (data) => {
        resolve({
          ws,
          message: JSON.parse(data.toString()) as PluginMessage,
        });
      });

      ws.once("error", reject);
    });
  }

  function nextMessage(ws: WebSocket): Promise<PluginMessage> {
    return new Promise((resolve) => {
      ws.once("message", (data) => {
        resolve(JSON.parse(data.toString()) as PluginMessage);
      });
    });
  }

  it("binds a random test port and exposes the actual bound port", () => {
    expect(server.getPort()).toBeGreaterThan(0);
  });

  it("sends sync message on connect", async () => {
    const { ws, message: msg } = await connectWithFirstMessage();

    expect(msg.type).toBe("sync");
    expect((msg as SyncMessage).sessions).toEqual([]);

    ws.close();
  });

  it("broadcasts state messages to all clients", async () => {
    const { ws: ws1 } = await connectWithFirstMessage();
    const { ws: ws2 } = await connectWithFirstMessage();

    const stateMsg: StateMessage = {
      type: "state",
      sessionId: "s1",
      state: "thinking",
      label: null,
      tokens: { total: 0, rate: 0 },
      timestamp: Date.now(),
    };

    const received1 = nextMessage(ws1);
    const received2 = nextMessage(ws2);

    server.broadcast(stateMsg);

    await expect(received1).resolves.toEqual(stateMsg);
    await expect(received2).resolves.toEqual(stateMsg);

    ws1.close();
    ws2.close();
  });

  it("includes session data in sync for new connections", async () => {
    server.setSyncData([
      {
        sessionId: "s1",
        name: "agent",
        state: "thinking",
        label: "test",
        tokens: { total: 100, rate: 50 },
      },
    ]);

    const { ws, message } = await connectWithFirstMessage();
    const msg = message as SyncMessage;

    expect(msg.type).toBe("sync");
    expect(msg.sessions).toEqual([
      {
        sessionId: "s1",
        name: "agent",
        state: "thinking",
        label: "test",
        tokens: { total: 100, rate: 50 },
      },
    ]);

    ws.close();
  });

  it("stops cleanly and rejects new connections after stop", async () => {
    const port = server.getPort();
    const { ws } = await connectWithFirstMessage(port);

    await server.stop();

    await expect(connectWithFirstMessage(port)).rejects.toBeDefined();
  });
});
