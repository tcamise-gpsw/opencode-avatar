import type { PluginInput } from "@opencode-ai/plugin";
import type { AppMessage, CommandResult } from "@opencode-avatar/shared";

import { createLogger } from "./logger.js";

/**
 * Routes app-issued reverse-channel commands to OpenCode SDK calls and
 * normalizes all outcomes into `command.result` responses.
 */

const log = createLogger("command-handler");

type SDKClient = PluginInput["client"];
type CommandLike =
  | AppMessage
  | {
    type: "command";
    command: string;
    sessionId: string;
    requestId: string;
    [key: string]: unknown;
  };

function getUnknownErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) {
    return error.message;
  }

  return String(error);
}

function success(requestId: string): CommandResult {
  return {
    type: "command.result",
    requestId,
    success: true,
  };
}

function failure(requestId: string, error: string): CommandResult {
  return {
    type: "command.result",
    requestId,
    success: false,
    error,
  };
}

export async function handleCommand(msg: CommandLike, client: SDKClient | null): Promise<CommandResult> {
  log.info("command_received", {
    command: msg.command,
    requestId: msg.requestId,
    sessionId: msg.sessionId,
  });

  if (!client) {
    const result = failure(msg.requestId, "sdk client unavailable");
    log.warn("command_failed_no_sdk_client", {
      command: msg.command,
      requestId: msg.requestId,
      sessionId: msg.sessionId,
    });
    log.info("command_result_returned", {
      requestId: result.requestId,
      success: result.success,
      error: result.error,
    });
    return result;
  }

  try {
    switch (msg.command) {
      case "prompt": {
        if (typeof msg.text !== "string") {
          const result = failure(msg.requestId, "invalid prompt command");
          log.warn("command_failed_invalid_prompt", {
            requestId: msg.requestId,
            sessionId: msg.sessionId,
          });
          log.info("command_result_returned", {
            requestId: result.requestId,
            success: result.success,
            error: result.error,
          });
          return result;
        }

        log.debug("command_prompt_execute", {
          requestId: msg.requestId,
          sessionId: msg.sessionId,
          textChars: msg.text.length,
        });

        await client.session.promptAsync({
          path: { id: msg.sessionId },
          body: {
            parts: [
              {
                type: "text",
                text: msg.text,
              },
            ],
          },
        });

        const result = success(msg.requestId);
        log.info("command_result_returned", {
          requestId: result.requestId,
          success: result.success,
        });
        return result;
      }

      case "permission.reply": {
        if (typeof msg.permissionId !== "string" || typeof msg.allow !== "boolean") {
          const result = failure(msg.requestId, "invalid permission.reply command");
          log.warn("command_failed_invalid_permission_reply", {
            requestId: msg.requestId,
            sessionId: msg.sessionId,
          });
          log.info("command_result_returned", {
            requestId: result.requestId,
            success: result.success,
            error: result.error,
          });
          return result;
        }

        const response = msg.allow ? "once" : "reject";
        log.debug("command_permission_reply_execute", {
          requestId: msg.requestId,
          sessionId: msg.sessionId,
          permissionId: msg.permissionId,
          response,
        });

        await client.postSessionIdPermissionsPermissionId({
          path: {
            id: msg.sessionId,
            permissionID: msg.permissionId,
          },
          body: {
            response,
          },
        });

        const result = success(msg.requestId);
        log.info("command_result_returned", {
          requestId: result.requestId,
          success: result.success,
        });
        return result;
      }

      default: {
        const result = failure(msg.requestId, "unknown command");
        log.warn("command_failed_unknown_command", {
          command: msg.command,
          requestId: msg.requestId,
          sessionId: msg.sessionId,
        });
        log.info("command_result_returned", {
          requestId: result.requestId,
          success: result.success,
          error: result.error,
        });
        return result;
      }
    }
  } catch (error) {
    const message = getUnknownErrorMessage(error);
    const result = failure(msg.requestId, message);

    log.error("command_failed_sdk_error", {
      command: msg.command,
      requestId: msg.requestId,
      sessionId: msg.sessionId,
      error: message,
    });
    log.info("command_result_returned", {
      requestId: result.requestId,
      success: result.success,
      error: result.error,
    });

    return result;
  }
}
