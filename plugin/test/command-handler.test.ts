import { describe, expect, it, vi } from "vitest";
import type { PluginInput } from "@opencode-ai/plugin";
import type { AppMessage } from "@opencode-avatar/shared";

import { handleCommand } from "../src/command-handler.js";

type SDKClient = PluginInput["client"];

function createMockClient() {
  const promptAsync = vi.fn(async () => undefined);
  const replyPermission = vi.fn(async () => true);

  const client = {
    session: {
      promptAsync,
    },
    postSessionIdPermissionsPermissionId: replyPermission,
  } as unknown as SDKClient;

  return { client, promptAsync, replyPermission };
}

describe("handleCommand", () => {
  it("runs prompt commands via session.promptAsync", async () => {
    const { client, promptAsync } = createMockClient();

    const result = await handleCommand(
      {
        type: "command",
        command: "prompt",
        sessionId: "session-1",
        text: "Hello from overlay",
        requestId: "req-1",
      },
      client,
    );

    expect(promptAsync).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: {
        parts: [{ type: "text", text: "Hello from overlay" }],
      },
    });
    expect(result).toEqual({
      type: "command.result",
      requestId: "req-1",
      success: true,
    });
  });

  it("maps allow permission replies to response=once", async () => {
    const { client, replyPermission } = createMockClient();

    const result = await handleCommand(
      {
        type: "command",
        command: "permission.reply",
        sessionId: "session-1",
        permissionId: "perm-1",
        allow: true,
        requestId: "req-2",
      },
      client,
    );

    expect(replyPermission).toHaveBeenCalledWith({
      path: { id: "session-1", permissionID: "perm-1" },
      body: { response: "once" },
    });
    expect(result.success).toBe(true);
  });

  it("maps deny permission replies to response=reject", async () => {
    const { client, replyPermission } = createMockClient();

    const result = await handleCommand(
      {
        type: "command",
        command: "permission.reply",
        sessionId: "session-2",
        permissionId: "perm-2",
        allow: false,
        requestId: "req-3",
      },
      client,
    );

    expect(replyPermission).toHaveBeenCalledWith({
      path: { id: "session-2", permissionID: "perm-2" },
      body: { response: "reject" },
    });
    expect(result.success).toBe(true);
  });

  it("returns a failure result when the sdk throws", async () => {
    const { client, promptAsync } = createMockClient();
    promptAsync.mockRejectedValueOnce(new Error("SDK exploded"));

    const result = await handleCommand(
      {
        type: "command",
        command: "prompt",
        sessionId: "session-1",
        text: "hello",
        requestId: "req-4",
      },
      client,
    );

    expect(result).toEqual({
      type: "command.result",
      requestId: "req-4",
      success: false,
      error: "SDK exploded",
    });
  });

  it("returns unknown command for unsupported command types", async () => {
    const { client } = createMockClient();

    const result = await handleCommand(
      {
        type: "command",
        command: "unsupported.command",
        sessionId: "session-1",
        requestId: "req-5",
      } as unknown as AppMessage,
      client,
    );

    expect(result).toEqual({
      type: "command.result",
      requestId: "req-5",
      success: false,
      error: "unknown command",
    });
  });

  it("returns descriptive error when sdk client is unavailable", async () => {
    const result = await handleCommand(
      {
        type: "command",
        command: "prompt",
        sessionId: "session-1",
        text: "hello",
        requestId: "req-6",
      },
      null,
    );

    expect(result).toEqual({
      type: "command.result",
      requestId: "req-6",
      success: false,
      error: "sdk client unavailable",
    });
  });
});
