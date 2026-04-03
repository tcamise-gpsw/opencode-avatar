import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { AppMessage, CommandResult, SessionInfo } from "@opencode-avatar/shared";
import { createLogger } from "./logger.js";

export type StoredCommandMessage =
  | AppMessage
  | {
    type: "command";
    command: string;
    sessionId: string;
    requestId: string;
    [key: string]: unknown;
  };

type PersistedInstanceState = {
  instanceId: string;
  updatedAt: number;
  sessions: SessionInfo[];
};

type PersistedCommandFile = {
  createdAt: number;
  message: StoredCommandMessage;
};

type PersistedResultFile = {
  createdAt: number;
  result: CommandResult;
};

export type CommandFile = PersistedCommandFile;
export type ResultFile = PersistedResultFile;

const DEFAULT_STATE_DIR = join(homedir(), ".opencode-avatar", "state");
const DEFAULT_STALE_MS = 15_000;
const COMMAND_FILE_PREFIX = "cmd-";
const RESULT_FILE_PREFIX = "result-";
const COMMAND_STALE_MS = 10_000;

const log = createLogger("shared-session-store");

export class SharedSessionStore {
  private readonly filePath: string;

  constructor(
    private readonly instanceId: string,
    private readonly directory: string = DEFAULT_STATE_DIR,
    private readonly staleMs: number = DEFAULT_STALE_MS,
  ) {
    this.filePath = join(this.directory, `${this.instanceId}.json`);
  }

  write(sessions: SessionInfo[], now: number = Date.now()): void {
    try {
      this.ensureDirectory();

      const payload: PersistedInstanceState = {
        instanceId: this.instanceId,
        updatedAt: now,
        sessions,
      };

      const tempPath = `${this.filePath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload));
      renameSync(tempPath, this.filePath);
      log.debug("shared_snapshot_written", { instanceId: this.instanceId, sessions: sessions.length });
    } catch (error) {
      log.error("shared_snapshot_write_failed", {
        error: this.getUnknownErrorMessage(error),
        instanceId: this.instanceId,
      });
    }
  }

  remove(): void {
    try {
      rmSync(this.filePath, { force: true });
    } catch {
      // Best effort cleanup only.
    }
  }

  removeSession(sessionId: string, now: number = Date.now()): boolean {
    try {
      this.ensureDirectory();

      let removed = false;
      for (const fileName of readdirSync(this.directory)) {
        if (
          !fileName.endsWith(".json") ||
          fileName.startsWith(COMMAND_FILE_PREFIX) ||
          fileName.startsWith(RESULT_FILE_PREFIX)
        ) {
          continue;
        }

        const filePath = join(this.directory, fileName);
        const state = this.readStateFile(filePath);
        if (!state) {
          continue;
        }

        const sessions = state.sessions.filter((session) => session.sessionId !== sessionId);
        if (sessions.length === state.sessions.length) {
          continue;
        }

        removed = true;

        if (sessions.length === 0) {
          this.safeRemove(filePath, "shared_snapshot_removed_empty");
          continue;
        }

        const payload: PersistedInstanceState = {
          instanceId: state.instanceId,
          updatedAt: now,
          sessions,
        };
        const tempPath = `${filePath}.tmp`;
        writeFileSync(tempPath, JSON.stringify(payload));
        renameSync(tempPath, filePath);
      }

      return removed;
    } catch (error) {
      log.error("shared_snapshot_session_remove_failed", {
        error: this.getUnknownErrorMessage(error),
        sessionId,
      });
      return false;
    }
  }

  readMerged(localSessions: SessionInfo[], now: number = Date.now()): SessionInfo[] {
    try {
      this.ensureDirectory();

      const merged = new Map<string, SessionInfo>();
      for (const session of localSessions) {
        merged.set(session.sessionId, session);
      }

      for (const fileName of readdirSync(this.directory)) {
        if (
          !fileName.endsWith(".json") ||
          fileName.startsWith(COMMAND_FILE_PREFIX) ||
          fileName.startsWith(RESULT_FILE_PREFIX)
        ) {
          continue;
        }

        const state = this.readStateFile(join(this.directory, fileName));
        if (!state || state.instanceId === this.instanceId) {
          continue;
        }

        if (now - state.updatedAt > this.staleMs) {
          this.safeRemove(join(this.directory, fileName), "stale_snapshot_removed");
          continue;
        }

        for (const session of state.sessions) {
          merged.set(session.sessionId, session);
        }
      }

      return Array.from(merged.values()).sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    } catch (error) {
      log.error("shared_snapshot_read_failed", {
        error: this.getUnknownErrorMessage(error),
        instanceId: this.instanceId,
      });
      return [...localSessions].sort((left, right) => left.sessionId.localeCompare(right.sessionId));
    }
  }

  writeCommand(message: StoredCommandMessage, now: number = Date.now()): boolean {
    try {
      this.ensureDirectory();

      const payload: PersistedCommandFile = {
        message,
        createdAt: now,
      };
      const finalPath = join(this.directory, `${COMMAND_FILE_PREFIX}${message.requestId}.json`);
      const tempPath = `${finalPath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload));
      renameSync(tempPath, finalPath);

      log.info("shared_command_written", {
        command: message.command,
        requestId: message.requestId,
        sessionId: message.sessionId,
      });
      return true;
    } catch (error) {
      log.error("shared_command_write_failed", {
        command: message.command,
        requestId: message.requestId,
        sessionId: message.sessionId,
        error: this.getUnknownErrorMessage(error),
      });
      return false;
    }
  }

  pollCommands(mySessionIds: Set<string>, now: number = Date.now()): CommandFile[] {
    try {
      this.ensureDirectory();
      const commands: CommandFile[] = [];

      for (const fileName of readdirSync(this.directory)) {
        if (!fileName.startsWith(COMMAND_FILE_PREFIX) || !fileName.endsWith(".json")) {
          continue;
        }

        const filePath = join(this.directory, fileName);
        const parsed = this.readCommandFile(filePath);
        if (!parsed) {
          continue;
        }

        if (now - parsed.createdAt > COMMAND_STALE_MS) {
          this.safeRemove(filePath, "shared_command_stale_removed");
          continue;
        }

        if (!mySessionIds.has(parsed.message.sessionId)) {
          continue;
        }

        commands.push(parsed);
        this.safeRemove(filePath, "shared_command_consumed");
      }

      return commands;
    } catch (error) {
      log.error("shared_command_poll_failed", {
        error: this.getUnknownErrorMessage(error),
      });
      return [];
    }
  }

  writeResult(result: CommandResult, now: number = Date.now()): boolean {
    try {
      this.ensureDirectory();

      const payload: PersistedResultFile = {
        result,
        createdAt: now,
      };
      const finalPath = join(this.directory, `${RESULT_FILE_PREFIX}${result.requestId}.json`);
      const tempPath = `${finalPath}.tmp`;
      writeFileSync(tempPath, JSON.stringify(payload));
      renameSync(tempPath, finalPath);

      log.info("shared_result_written", {
        requestId: result.requestId,
        success: result.success,
      });
      return true;
    } catch (error) {
      log.error("shared_result_write_failed", {
        requestId: result.requestId,
        error: this.getUnknownErrorMessage(error),
      });
      return false;
    }
  }

  pollResults(): ResultFile[] {
    try {
      this.ensureDirectory();
      const results: ResultFile[] = [];

      for (const fileName of readdirSync(this.directory)) {
        if (!fileName.startsWith(RESULT_FILE_PREFIX) || !fileName.endsWith(".json")) {
          continue;
        }

        const filePath = join(this.directory, fileName);
        const parsed = this.readResultFile(filePath);
        if (!parsed) {
          continue;
        }

        results.push(parsed);
        this.safeRemove(filePath, "shared_result_consumed");
      }

      return results;
    } catch (error) {
      log.error("shared_result_poll_failed", {
        error: this.getUnknownErrorMessage(error),
      });
      return [];
    }
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true });
  }

  private safeRemove(filePath: string, message: string): void {
    try {
      rmSync(filePath, { force: true });
      log.debug(message, { filePath });
    } catch (error) {
      log.warn("shared_file_remove_failed", {
        filePath,
        error: this.getUnknownErrorMessage(error),
      });
    }
  }

  private readStateFile(filePath: string): PersistedInstanceState | null {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<PersistedInstanceState>;
      if (
        typeof parsed.instanceId !== "string" ||
        typeof parsed.updatedAt !== "number" ||
        !Array.isArray(parsed.sessions)
      ) {
        return null;
      }

      return {
        instanceId: parsed.instanceId,
        updatedAt: parsed.updatedAt,
        sessions: parsed.sessions as SessionInfo[],
      };
    } catch {
      return null;
    }
  }

  private readCommandFile(filePath: string): PersistedCommandFile | null {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<PersistedCommandFile>;
      if (!parsed || typeof parsed.createdAt !== "number" || !this.isStoredCommandMessage(parsed.message)) {
        return null;
      }

      return {
        createdAt: parsed.createdAt,
        message: parsed.message,
      };
    } catch {
      return null;
    }
  }

  private readResultFile(filePath: string): PersistedResultFile | null {
    try {
      const parsed = JSON.parse(readFileSync(filePath, "utf8")) as Partial<PersistedResultFile>;
      if (!parsed || typeof parsed.createdAt !== "number" || !this.isCommandResult(parsed.result)) {
        return null;
      }

      return {
        createdAt: parsed.createdAt,
        result: parsed.result,
      };
    } catch {
      return null;
    }
  }

  private isStoredCommandMessage(value: unknown): value is StoredCommandMessage {
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

  private isCommandResult(value: unknown): value is CommandResult {
    if (!value || typeof value !== "object") {
      return false;
    }

    const candidate = value as Record<string, unknown>;
    return (
      candidate.type === "command.result" &&
      typeof candidate.requestId === "string" &&
      typeof candidate.success === "boolean" &&
      (candidate.error === undefined || typeof candidate.error === "string")
    );
  }

  private getUnknownErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.length > 0) {
      return error.message;
    }

    return String(error);
  }
}
