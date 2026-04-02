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

function getCurrentLevel(): LogLevel {
  const value = process.env.AVATAR_LOG_LEVEL;
  if (value === "debug" || value === "info" || value === "warn" || value === "error") {
    return value;
  }
  return "info";
}

let currentLevel: LogLevel = getCurrentLevel();

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
    ...data,
  };

  return JSON.stringify(entry);
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
    console.error(formatted);
    writeLog(formatted);
  }

  return {
    debug: (msg: string, data?: Record<string, unknown>) => log("debug", msg, data),
    info: (msg: string, data?: Record<string, unknown>) => log("info", msg, data),
    warn: (msg: string, data?: Record<string, unknown>) => log("warn", msg, data),
    error: (msg: string, data?: Record<string, unknown>) => log("error", msg, data),
  };
}
