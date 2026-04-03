import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import type { AppMessage, CommandResult, SessionInfo } from "@opencode-avatar/shared";
import { SharedSessionStore } from "../src/shared-session-store.js";

const tempDirectories: string[] = [];

function createTempDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "opencode-avatar-shared-store-"));
  tempDirectories.push(directory);
  return directory;
}

function createSession(sessionId: string, overrides: Partial<SessionInfo> = {}): SessionInfo {
  return {
    sessionId,
    name: sessionId,
    state: "thinking",
    label: null,
    tokens: { total: 0, rate: 0 },
    lastResponse: null,
    pendingPermission: null,
    ...overrides,
  };
}

function createPromptCommand(requestId: string, sessionId: string): AppMessage {
  return {
    type: "command",
    command: "prompt",
    requestId,
    sessionId,
    text: `hello-${requestId}`,
  };
}

function createResult(requestId: string, success = true): CommandResult {
  return {
    type: "command.result",
    requestId,
    success,
  };
}

afterEach(() => {
  while (tempDirectories.length > 0) {
    const directory = tempDirectories.pop();
    if (!directory) {
      continue;
    }

    rmSync(directory, { force: true, recursive: true });
  }
});

describe("SharedSessionStore", () => {
  it("merges local and remote instance snapshots", () => {
    const directory = createTempDirectory();
    const localStore = new SharedSessionStore("instance-a", directory);
    const remoteStore = new SharedSessionStore("instance-b", directory);

    localStore.write([createSession("session-a", { name: "Window A" })], 1_000);
    remoteStore.write([createSession("session-b", { name: "Window B" })], 1_000);

    expect(localStore.readMerged([createSession("session-a", { name: "Window A" })], 1_000)).toEqual([
      createSession("session-a", { name: "Window A" }),
      createSession("session-b", { name: "Window B" }),
    ]);
  });

  it("ignores and deletes stale instance snapshots", () => {
    const directory = createTempDirectory();
    const localStore = new SharedSessionStore("instance-a", directory, 5_000);
    const staleStore = new SharedSessionStore("instance-b", directory, 5_000);
    const staleFilePath = join(directory, "instance-b.json");

    staleStore.write([createSession("stale-session")], 1_000);

    const merged = localStore.readMerged([createSession("fresh-session")], 7_000);

    expect(merged).toEqual([createSession("fresh-session")]);
    expect(existsSync(staleFilePath)).toBe(false);
  });

  it("ignores malformed state files", () => {
    const directory = createTempDirectory();
    const localStore = new SharedSessionStore("instance-a", directory);

    writeFileSync(join(directory, "broken.json"), "not json");

    expect(localStore.readMerged([createSession("fresh-session")], 1_000)).toEqual([
      createSession("fresh-session"),
    ]);
  });

  it("writes command files using cmd-{requestId}.json", () => {
    const directory = createTempDirectory();
    const store = new SharedSessionStore("instance-a", directory);
    const message = createPromptCommand("req-1", "session-1");

    store.writeCommand(message, 1_234);

    const path = join(directory, "cmd-req-1.json");
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({
      createdAt: 1_234,
      message,
    });
  });

  it("polls and consumes only commands for local sessions", () => {
    const directory = createTempDirectory();
    const store = new SharedSessionStore("instance-a", directory);

    const local = createPromptCommand("req-local", "session-local");
    const remote = createPromptCommand("req-remote", "session-remote");

    store.writeCommand(local, 1_000);
    store.writeCommand(remote, 1_000);

    const commands = store.pollCommands(new Set(["session-local"]), 1_001);
    expect(commands).toHaveLength(1);
    expect(commands[0]?.message).toEqual(local);
    expect(existsSync(join(directory, "cmd-req-local.json"))).toBe(false);
    expect(existsSync(join(directory, "cmd-req-remote.json"))).toBe(true);
  });

  it("writes and polls result files", () => {
    const directory = createTempDirectory();
    const store = new SharedSessionStore("instance-a", directory);

    const result = createResult("req-1", false);
    store.writeResult(result, 1_500);

    const path = join(directory, "result-req-1.json");
    expect(existsSync(path)).toBe(true);

    const results = store.pollResults();
    expect(results).toEqual([{ createdAt: 1_500, result }]);
    expect(existsSync(path)).toBe(false);
  });

  it("drops stale command files older than 10 seconds", () => {
    const directory = createTempDirectory();
    const store = new SharedSessionStore("instance-a", directory);
    const message = createPromptCommand("req-stale", "session-stale");

    store.writeCommand(message, 1_000);

    const polled = store.pollCommands(new Set(["session-stale"]), 11_100);
    expect(polled).toEqual([]);
    expect(existsSync(join(directory, "cmd-req-stale.json"))).toBe(false);
  });

  it("handles file io errors without throwing", () => {
    const directory = createTempDirectory();
    const badPath = join(directory, "not-a-directory");
    writeFileSync(badPath, "occupied");

    const store = new SharedSessionStore("instance-a", badPath);

    expect(() => store.write([createSession("session-1")], 1_000)).not.toThrow();
    expect(() => store.readMerged([createSession("session-1")], 1_000)).not.toThrow();
    expect(() => store.writeCommand(createPromptCommand("req-io", "session-1"), 1_000)).not.toThrow();
    expect(() => store.pollCommands(new Set(["session-1"]), 1_000)).not.toThrow();
    expect(() => store.writeResult(createResult("req-io"), 1_000)).not.toThrow();
    expect(() => store.pollResults()).not.toThrow();
  });
});
