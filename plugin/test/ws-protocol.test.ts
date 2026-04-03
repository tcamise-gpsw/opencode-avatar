import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";
import type {
  AppMessage,
  CommandResult,
  PluginMessage,
  StateMessage,
  SyncMessage,
} from "@opencode-avatar/shared";
import { AvatarWSServer } from "../src/ws-server.js";
import pluginModule, { server as pluginServer } from "../src/index.js";

describe("plugin module packaging", () => {
  it("exports an id and server entrypoint for OpenCode plugin loading", () => {
    expect(pluginServer).toBeTypeOf("function");
    expect(pluginModule.id).toBe("opencode-avatar");
    expect(pluginModule.server).toBe(pluginServer);
  });
});

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
        lastResponse: null,
        pendingPermission: null,
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
        lastResponse: null,
        pendingPermission: null,
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

  it("does not leave a live server behind when stop overlaps startup", async () => {
    const overlappingServer = new AvatarWSServer(0);

    const startPromise = overlappingServer.start();
    const stopPromise = overlappingServer.stop();

    await Promise.allSettled([startPromise, stopPromise]);

    expect(overlappingServer.getPort()).toBe(0);
  });

  it("can start cleanly after a stop interrupts startup", async () => {
    const restartingServer = new AvatarWSServer(0);

    const firstStart = restartingServer.start();
    const stopPromise = restartingServer.stop();
    const secondStart = restartingServer.start();

    await Promise.allSettled([firstStart, stopPromise]);
    await secondStart;

    const port = restartingServer.getPort();
    expect(port).toBeGreaterThan(0);

    const { ws, message } = await connectWithFirstMessage(port);
    expect(message.type).toBe("sync");

    ws.close();
    await restartingServer.stop();
  });

  it("routes prompt commands to message handler and replies on same socket", async () => {
    const { ws } = await connectWithFirstMessage();
    const seen: AppMessage[] = [];

    server.setMessageHandler((message, reply) => {
      seen.push(message);
      reply({
        type: "command.result",
        requestId: message.requestId,
        success: true,
      });
    });

    const sent = {
      type: "command",
      command: "prompt",
      sessionId: "session-1",
      text: "hello",
      requestId: "req-1",
    } as const;

    const received = nextMessage(ws) as Promise<CommandResult>;
    ws.send(JSON.stringify(sent));

    await expect(received).resolves.toEqual({
      type: "command.result",
      requestId: "req-1",
      success: true,
    });
    expect(seen).toEqual([sent]);

    ws.close();
  });

  it("routes permission.reply commands to message handler", async () => {
    const { ws } = await connectWithFirstMessage();
    const seen: AppMessage[] = [];

    server.setMessageHandler((message, reply) => {
      seen.push(message);
      reply({
        type: "command.result",
        requestId: message.requestId,
        success: true,
      });
    });

    const sent = {
      type: "command",
      command: "permission.reply",
      sessionId: "session-2",
      permissionId: "perm-1",
      allow: false,
      requestId: "req-2",
    } as const;

    const received = nextMessage(ws) as Promise<CommandResult>;
    ws.send(JSON.stringify(sent));

    await expect(received).resolves.toEqual({
      type: "command.result",
      requestId: "req-2",
      success: true,
    });
    expect(seen).toEqual([sent]);

    ws.close();
  });

  it("keeps connection open and ignores malformed json", async () => {
    const { ws } = await connectWithFirstMessage();
    const handler = vi.fn();
    server.setMessageHandler(handler);

    ws.send("{ definitely not valid json");
    await new Promise((resolve) => setTimeout(resolve, 40));

    expect(handler).not.toHaveBeenCalled();
    expect(ws.readyState).toBe(WebSocket.OPEN);

    ws.close();
  });

  it("forwards unknown command values to handler for decision", async () => {
    const { ws } = await connectWithFirstMessage();
    const seen: AppMessage[] = [];

    server.setMessageHandler((message, reply) => {
      seen.push(message);
      reply({
        type: "command.result",
        requestId: message.requestId,
        success: false,
        error: "unknown command",
      });
    });

    const sent = {
      type: "command",
      command: "unknown.command",
      sessionId: "session-3",
      requestId: "req-3",
    } as unknown as AppMessage;

    const received = nextMessage(ws) as Promise<CommandResult>;
    ws.send(JSON.stringify(sent));

    await expect(received).resolves.toEqual({
      type: "command.result",
      requestId: "req-3",
      success: false,
      error: "unknown command",
    });
    expect(seen).toEqual([sent]);

    ws.close();
  });
});
