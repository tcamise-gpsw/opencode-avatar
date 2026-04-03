import { beforeEach, describe, expect, it, vi } from "vitest";

import { createLogger } from "../src/logger.js";

const appendFileSyncMock = vi.hoisted(() => vi.fn());
const mkdirSyncMock = vi.hoisted(() => vi.fn());

vi.mock("fs", () => ({
  appendFileSync: appendFileSyncMock,
  mkdirSync: mkdirSyncMock,
}));

describe("plugin logger", () => {
  beforeEach(() => {
    appendFileSyncMock.mockReset();
    mkdirSyncMock.mockReset();
    vi.restoreAllMocks();
    delete process.env.AVATAR_LOG_LEVEL;
    delete process.env.AVATAR_LOG_STDERR;
  });

  it("writes logs to file without mirroring to stderr by default", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("plugin");

    logger.info("session_created", { sessionId: "abc" });

    expect(appendFileSyncMock).toHaveBeenCalledOnce();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it("mirrors logs to stderr when explicitly enabled", () => {
    process.env.AVATAR_LOG_STDERR = "1";
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logger = createLogger("plugin");

    logger.error("session_error", { sessionId: "abc" });

    expect(appendFileSyncMock).toHaveBeenCalledOnce();
    expect(errorSpy).toHaveBeenCalledOnce();
  });
});
