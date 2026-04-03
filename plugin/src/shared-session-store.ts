import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "fs";
import { homedir } from "os";
import { join } from "path";

import type { SessionInfo } from "@opencode-avatar/shared";

type PersistedInstanceState = {
  instanceId: string;
  updatedAt: number;
  sessions: SessionInfo[];
};

const DEFAULT_STATE_DIR = join(homedir(), ".opencode-avatar", "state");
const DEFAULT_STALE_MS = 15_000;

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
    this.ensureDirectory();

    const payload: PersistedInstanceState = {
      instanceId: this.instanceId,
      updatedAt: now,
      sessions,
    };

    const tempPath = `${this.filePath}.tmp`;
    writeFileSync(tempPath, JSON.stringify(payload));
    renameSync(tempPath, this.filePath);
  }

  remove(): void {
    try {
      rmSync(this.filePath, { force: true });
    } catch {
      // Best effort cleanup only.
    }
  }

  readMerged(localSessions: SessionInfo[], now: number = Date.now()): SessionInfo[] {
    this.ensureDirectory();

    const merged = new Map<string, SessionInfo>();
    for (const session of localSessions) {
      merged.set(session.sessionId, session);
    }

    for (const fileName of readdirSync(this.directory)) {
      if (!fileName.endsWith(".json")) {
        continue;
      }

      const state = this.readStateFile(join(this.directory, fileName));
      if (!state || state.instanceId === this.instanceId) {
        continue;
      }

      if (now - state.updatedAt > this.staleMs) {
        try {
          rmSync(join(this.directory, fileName), { force: true });
        } catch {
          // Ignore stale cleanup errors.
        }
        continue;
      }

      for (const session of state.sessions) {
        merged.set(session.sessionId, session);
      }
    }

    return Array.from(merged.values()).sort((left, right) => left.sessionId.localeCompare(right.sessionId));
  }

  private ensureDirectory(): void {
    mkdirSync(this.directory, { recursive: true });
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
}
