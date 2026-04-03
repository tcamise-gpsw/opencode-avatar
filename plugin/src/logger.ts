import { appendFileSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const LOG_DIR = join(homedir(), ".opencode-avatar", "logs");
const LOG_FILE = join(LOG_DIR, "plugin.log");
const RESERVED_FIELDS = new Set(["ts", "level", "component", "msg", "logSerializationError"]);

function getCurrentLevel(): LogLevel {
  const value = process.env.AVATAR_LOG_LEVEL;
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

let currentLevel: LogLevel = getCurrentLevel();

function shouldMirrorToStderr(): boolean {
  return process.env.AVATAR_LOG_STDERR === "1";
}

function ensureLogDir(): void {
  try {
    mkdirSync(LOG_DIR, { recursive: true });
  } catch {
    // Already exists or can't create; fall back to stderr only.
  }
}

function formatMessage(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg: message,
    ...sanitizeData(data),
  };

  try {
    return JSON.stringify(entry);
  } catch (error) {
    return JSON.stringify({
      ts: entry.ts,
      level,
      component,
      msg: message,
      logSerializationError: String(error),
    });
  }
}

function sanitizeData(data?: Record<string, unknown>): Record<string, unknown> {
  if (!data) {
    return {};
  }

  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (RESERVED_FIELDS.has(key)) {
      sanitized[`meta_${key}`] = value;
      continue;
    }
    sanitized[key] = value;
  }

  return sanitized;
}

function writeLog(formatted: string): void {
  try {
    appendFileSync(LOG_FILE, `${formatted}\n`);
  } catch {
    // Best-effort file logging.
  }
}

export function createLogger(component: string) {
  ensureLogDir();

  function log(level: LogLevel, message: string, data?: Record<string, unknown>): void {
    currentLevel = getCurrentLevel();
    if (LEVEL_ORDER[level] < LEVEL_ORDER[currentLevel]) {
      return;
    }

    const formatted = formatMessage(level, component, message, data);
    if (shouldMirrorToStderr()) {
      console.error(formatted);
    }
    writeLog(formatted);
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}
