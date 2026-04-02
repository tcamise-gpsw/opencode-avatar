type ImportMetaEnvLike = {
  readonly VITE_DEBUG?: string;
  readonly VITE_LOG_LEVEL?: string;
};

export type LogLevel = "debug" | "info" | "warn" | "error";

export const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

const env = (import.meta as ImportMeta & { env?: ImportMetaEnvLike }).env;
const requestedLevel = env?.VITE_LOG_LEVEL?.toLowerCase();

const currentLevel: LogLevel =
  requestedLevel && requestedLevel in LEVEL_ORDER
    ? (requestedLevel as LogLevel)
    : "info";

const debugEnabled = env?.VITE_DEBUG === "1";

type LogExtra = Record<string, unknown>;

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[currentLevel];
}

function writeLog(
  level: LogLevel,
  component: string,
  msg: string,
  extra?: LogExtra,
): void {
  if (!shouldLog(level)) {
    return;
  }

  const entry = {
    ts: new Date().toISOString(),
    level,
    component,
    msg,
    ...(extra ?? {}),
  };

  const payload = JSON.stringify(entry);

  if (level === "error") {
    console.error(payload);
    return;
  }

  if (level === "warn") {
    console.warn(payload);
    return;
  }

  console.log(payload);
}

export const isDebug = debugEnabled;

export function createLogger(component: string) {
  return {
    debug(msg: string, extra?: LogExtra): void {
      writeLog("debug", component, msg, extra);
    },
    info(msg: string, extra?: LogExtra): void {
      writeLog("info", component, msg, extra);
    },
    warn(msg: string, extra?: LogExtra): void {
      writeLog("warn", component, msg, extra);
    },
    error(msg: string, extra?: LogExtra): void {
      writeLog("error", component, msg, extra);
    },
    isDebug(): boolean {
      return debugEnabled;
    },
  };
}
