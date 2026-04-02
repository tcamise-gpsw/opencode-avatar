import { createLogger } from "./logger.js";
import { AvatarRenderer } from "./renderer.js";
import { AvatarWSClient } from "./ws-client.js";

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

  await renderer.init({ canvas: resolveMount(root) });

  renderer.canvas.style.display = "block";

  if (renderer.canvas.parentElement !== root) {
    root.replaceChildren(renderer.canvas);
  }

  renderer.setDisconnected(true);

  const wsClient = new AvatarWSClient(wsUrl, {
    onConnected: () => {
      renderer.setDisconnected(false);
    },
    onDisconnected: () => {
      renderer.setDisconnected(true);
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
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
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
