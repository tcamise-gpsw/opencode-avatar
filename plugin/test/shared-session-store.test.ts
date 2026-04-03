import { existsSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, describe, expect, it } from "vitest";

import type { SessionInfo } from "@opencode-avatar/shared";
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
    ...overrides,
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
});
