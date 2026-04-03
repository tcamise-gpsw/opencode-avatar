import { createLogger } from "./logger.js";
import { AvatarRenderer } from "./renderer.js";
import { AvatarWSClient } from "./ws-client.js";

type PendingRequestContext = {
  kind: "prompt" | "permission.reply";
};

type ImportMetaEnvLike = {
  readonly VITE_AVATAR_WS_URL?: string;
};

const DEFAULT_WS_URL = "ws://127.0.0.1:2728";

const log = createLogger("main");

function resolveWsUrl(): string {
  const env = (import.meta as ImportMeta & { env?: ImportMetaEnvLike }).env;
  return env?.VITE_AVATAR_WS_URL?.trim() || DEFAULT_WS_URL;
}

function resolveMount(root: HTMLElement): HTMLCanvasElement | undefined {
  if (root instanceof HTMLCanvasElement) {
    return root;
  }

  const existingCanvas = root.querySelector("canvas");
  return existingCanvas instanceof HTMLCanvasElement ? existingCanvas : undefined;
}

async function bootstrap(): Promise<void> {
  const root = document.getElementById("app");
  if (!(root instanceof HTMLElement)) {
    throw new Error("Missing #app mount element");
  }

  root.style.width = "100vw";
  root.style.height = "100vh";

  const wsUrl = resolveWsUrl();
  const renderer = new AvatarRenderer();
  const tooltip = document.getElementById("robot-tooltip");

  await renderer.init({ canvas: resolveMount(root), mount: root, tooltip });

  renderer.canvas.style.display = "block";
  renderer.canvas.style.width = "100vw";
  renderer.canvas.style.height = "100vh";

  if (renderer.canvas.parentElement !== root) {
    root.replaceChildren(renderer.canvas);
  }

  const handleResize = () => {
    renderer.resizeViewport(window.innerWidth, window.innerHeight);
  };

  handleResize();
  window.addEventListener("resize", handleResize);

  renderer.setDisconnected(true);

  const wsClient = new AvatarWSClient(wsUrl, {
    onConnected: () => {
      renderer.setDisconnected(false);
    },
    onDisconnected: () => {
      renderer.setDisconnected(true);
    },
    onCommandResult: (message) => {
      const context = pendingRequests.get(message.requestId);
      if (context) {
        pendingRequests.delete(message.requestId);
      }

      if (context?.kind === "prompt") {
        renderer.showPromptResult(message);
      } else if (!message.success) {
        renderer.showPromptResult(message);
      }
    },
    onSession: (message) => {
      renderer.applySession(message);
    },
    onState: (message) => {
      renderer.applyState(message);
    },
    onSync: (message) => {
      renderer.updateSync(message);
    },
  });

  let cleanedUp = false;
  const pendingRequests = new Map<string, PendingRequestContext>();

  renderer.onPrompt = (sessionId, text) => {
    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, { kind: "prompt" });
    wsClient.send({
      type: "command",
      command: "prompt",
      sessionId,
      text,
      requestId,
    });
  };

  renderer.onPermissionReply = (sessionId, permissionId, allow) => {
    const requestId = crypto.randomUUID();
    pendingRequests.set(requestId, { kind: "permission.reply" });
    wsClient.send({
      type: "command",
      command: "permission.reply",
      sessionId,
      permissionId,
      allow,
      requestId,
    });
  };

  renderer.onCloseRobot = (sessionId) => {
    wsClient.send({
      type: "command",
      command: "robot.close",
      sessionId,
      requestId: crypto.randomUUID(),
    });
  };

  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    window.removeEventListener("resize", handleResize);
    wsClient.disconnect();
    renderer.destroy();
    log.info("app_cleaned_up");
  };

  window.addEventListener("beforeunload", cleanup, { once: true });
  window.addEventListener(
    "pagehide",
    (event) => {
      if (!event.persisted) {
        cleanup();
      }
    },
  );

  wsClient.connect();

  log.info("app_bootstrapped", { wsUrl });
}

void bootstrap().catch((error) => {
  log.error("app_bootstrap_failed", { error: String(error) });
  throw error;
});
