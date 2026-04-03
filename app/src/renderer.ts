import { Application, Container, Texture } from "pixi.js";

import type {
  CommandResult,
  SessionInfo,
  SessionMessage,
  StateMessage,
  SyncMessage,
  TokenData,
} from "@opencode-avatar/shared";

import { TokenFlameEffect } from "./flames.js";
import { createLogger } from "./logger.js";
import { Robot } from "./robot.js";
import { FRAME_SIZE, generateSpriteTextures } from "./sprites.js";
import { LAYOUT } from "./types.js";

const log = createLogger("renderer");

const MIN_CANVAS_HEIGHT = 100;
const RENDERER_WIDTH = LAYOUT.robotSize + LAYOUT.edgeMargin * 2;
const FLAME_SCALE = LAYOUT.robotSize / FRAME_SIZE;
const FLAME_Y = LAYOUT.robotSize - 4;
const EXPANDED_OVERLAY_WIDTH = 920;
const PROMPT_PANEL_LEFT_BIAS = 220;
const TOOLTIP_GAP = 20;
const TOOLTIP_LEFT_BIAS = 48;
const TOOLTIP_MAX_WIDTH = 520;
const PROMPT_MAX_WIDTH = 420;
const TOOLTIP_SHOW_DELAY_MS = 150;
const TOOLTIP_HIDE_DELAY_MS = 120;

let tauriInvoke: ((command: string, args?: Record<string, unknown>) => Promise<unknown>) | null = null;

type SessionSnapshot = {
  sessionId: string;
  name: string;
  label: string | null;
  tokens: TokenData;
  lastResponse: string | null;
  pendingPermission: {
    permissionId: string;
    title: string;
  } | null;
};

type FloatingUiMode = "none" | "tooltip" | "prompt" | "context-menu" | "permission";

type ManagedRobot = {
  readonly wrapper: Container;
  readonly robot: Robot;
  readonly flames: TokenFlameEffect;
  readonly createdAt: number;
  readonly hitbox: HTMLDivElement;
  session: SessionSnapshot;
};

export type AvatarRendererInitOptions = {
  canvas?: HTMLCanvasElement;
  mount?: HTMLElement | null;
  tooltip?: HTMLElement | null;
};

export class AvatarRenderer {
  onPrompt?: (sessionId: string, text: string) => void;
  onPermissionReply?: (sessionId: string, permissionId: string, allow: boolean) => void;

  private app: Application | null = null;
  private robotLayer: Container | null = null;
  private readonly robots = new Map<string, ManagedRobot>();
  private readonly pendingOperations: Array<() => void> = [];
  private textures = new Map<string, Texture>();
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private disconnected = false;
  private animationFrame: number | null = null;
  private lastFrameTime = 0;
  private lifecycleVersion = 0;
  private rootElement: HTMLElement | null = null;
  private tooltipElement: HTMLElement | null = null;
  private promptPanelElement: HTMLElement | null = null;
  private promptInputElement: HTMLInputElement | null = null;
  private promptSendButtonElement: HTMLButtonElement | null = null;
  private promptCloseButtonElement: HTMLButtonElement | null = null;
  private promptFeedbackElement: HTMLElement | null = null;
  private contextMenuElement: HTMLElement | null = null;
  private contextMenuTitleElement: HTMLElement | null = null;
  private contextMenuToggleSizeButtonElement: HTMLButtonElement | null = null;
  private permissionPopupElement: HTMLElement | null = null;
  private permissionTitleElement: HTMLElement | null = null;
  private permissionAllowButtonElement: HTMLButtonElement | null = null;
  private permissionDenyButtonElement: HTMLButtonElement | null = null;
  private activePromptSessionId: string | null = null;
  private activePermission: { sessionId: string; permissionId: string } | null = null;
  private activeTooltipSessionId: string | null = null;
  private activeContextMenuSessionId: string | null = null;
  private maximizedSessionId: string | null = null;
  private floatingUiMode: FloatingUiMode = "none";
  private windowExpanded = false;
  private appliedWindowModeKey: string | null = null;
  private resizeSettleTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipShowTimer: ReturnType<typeof setTimeout> | null = null;
  private tooltipHideTimer: ReturnType<typeof setTimeout> | null = null;

  async init(options: AvatarRendererInitOptions = {}): Promise<void> {
    if (this.initialized) {
      return;
    }

    if (this.initPromise) {
      return this.initPromise;
    }

    this.initPromise = (async () => {
      const initVersion = this.lifecycleVersion;
      const app = new Application();
      const robotLayer = new Container();

      await app.init({
        antialias: false,
        backgroundAlpha: 0,
        canvas: options.canvas,
        height: MIN_CANVAS_HEIGHT,
        width: RENDERER_WIDTH,
      });

      if (initVersion !== this.lifecycleVersion) {
        app.destroy(true, { children: true, texture: true });
        return;
      }

      this.app = app;
      this.robotLayer = robotLayer;
      this.rootElement = options.mount instanceof HTMLElement
        ? options.mount
        : app.canvas.parentElement instanceof HTMLElement
          ? app.canvas.parentElement
          : null;
      this.tooltipElement = options.tooltip instanceof HTMLElement ? options.tooltip : null;
      this.promptPanelElement = document.getElementById("prompt-panel");
      this.promptInputElement = document.getElementById("prompt-input") as HTMLInputElement | null;
      this.promptSendButtonElement = document.getElementById("prompt-send") as HTMLButtonElement | null;
      this.promptCloseButtonElement = document.getElementById("prompt-close") as HTMLButtonElement | null;
      this.promptFeedbackElement = document.getElementById("prompt-feedback");
      this.contextMenuElement = document.getElementById("robot-context-menu");
      this.contextMenuTitleElement = document.getElementById("context-menu-title");
      this.contextMenuToggleSizeButtonElement = document.getElementById("context-menu-toggle-size") as HTMLButtonElement | null;
      this.permissionPopupElement = document.getElementById("permission-popup");
      this.permissionTitleElement = document.getElementById("permission-title");
      this.permissionAllowButtonElement = document.getElementById("permission-allow") as HTMLButtonElement | null;
      this.permissionDenyButtonElement = document.getElementById("permission-deny") as HTMLButtonElement | null;

      this.promptSendButtonElement?.addEventListener("click", () => {
        this.submitPrompt();
      });
      this.promptCloseButtonElement?.addEventListener("click", () => {
        this.hidePromptPanel();
      });
      this.contextMenuElement?.addEventListener("contextmenu", (event) => {
        event.preventDefault();
      });
      this.contextMenuToggleSizeButtonElement?.addEventListener("click", () => {
        const sessionId = this.activeContextMenuSessionId;
        if (!sessionId) {
          return;
        }

        this.toggleMaximizedSession(sessionId);
      });
      this.promptInputElement?.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          this.submitPrompt();
          return;
        }

        if (event.key === "Escape") {
          event.preventDefault();
          this.hidePromptPanel();
        }
      });

      this.permissionAllowButtonElement?.addEventListener("click", () => {
        this.submitPermissionReply(true);
      });
      this.permissionDenyButtonElement?.addEventListener("click", () => {
        this.submitPermissionReply(false);
      });

      window.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
          this.hideContextMenu();
          this.hidePromptPanel();
        }
      });
      window.addEventListener("pointerdown", (event) => {
        const menu = this.contextMenuElement;
        if (!menu || this.activeContextMenuSessionId === null) {
          return;
        }

        const target = event.target;
        if (!(target instanceof Node)) {
          this.hideContextMenu();
          return;
        }

        if (menu.contains(target)) {
          return;
        }

        if (target instanceof HTMLElement && target.dataset.sessionId) {
          return;
        }

        this.hideContextMenu();
      }, true);
      window.addEventListener("blur", () => {
        this.hideContextMenu();
      });
      this.textures = generateSpriteTextures(app);
      this.robotLayer.eventMode = "none";
      this.app.stage.eventMode = "none";
      this.app.stage.addChild(this.robotLayer);

      this.initialized = true;
      this.startAnimationLoop();
      this.flushPendingOperations();

      log.info("renderer_initialized", {
        height: MIN_CANVAS_HEIGHT,
        width: RENDERER_WIDTH,
      });
    })().finally(() => {
      this.initPromise = null;
    });

    return this.initPromise;
  }

  get canvas(): HTMLCanvasElement {
    if (!this.app) {
      throw new Error("Renderer not initialized");
    }

    return this.app.canvas;
  }

  resizeViewport(width: number, height: number): void {
    if (!this.app) {
      return;
    }

    const nextWidth = Math.max(RENDERER_WIDTH, Math.floor(width));
    const nextHeight = Math.max(MIN_CANVAS_HEIGHT, Math.floor(height));

    this.app.renderer.resize(nextWidth, nextHeight);
    this.relayout();
  }

  updateSync(message: SyncMessage): void {
    if (!this.runOrQueue(() => this.updateSync(message))) {
      return;
    }

    const nextSessionIds = new Set(message.sessions.map((session) => session.sessionId));

    for (const sessionId of this.robots.keys()) {
      if (!nextSessionIds.has(sessionId)) {
        this.removeRobot(sessionId, "sync_missing");
      }
    }

    for (const session of message.sessions) {
      this.upsertSession(session);
    }

    log.info("renderer_sync_applied", {
      count: message.sessions.length,
    });
  }

  applyState(message: StateMessage): void {
    if (!this.runOrQueue(() => this.applyState(message))) {
      return;
    }

    const managed = this.ensureRobot(message.sessionId, {
      label: message.label,
      lastResponse: null,
      pendingPermission: null,
      tokens: message.tokens,
    });

    managed.session.label = message.label;
    managed.session.tokens = message.tokens;
    managed.robot.setState(message.state);
    managed.robot.setTokens(message.tokens);
    managed.robot.setDisconnected(this.disconnected);
    managed.flames.setRate(this.disconnected ? 0 : message.tokens.rate);

    log.debug("renderer_state_applied", {
      label: message.label,
      rate: message.tokens.rate,
      sessionId: message.sessionId,
      state: message.state,
    });
  }

  applySession(message: SessionMessage): void {
    if (!this.runOrQueue(() => this.applySession(message))) {
      return;
    }

    if (message.action === "ended") {
      this.removeRobot(message.sessionId, "session_ended");
      return;
    }

    const managed = this.ensureRobot(message.sessionId, {
      name: message.name,
    });

    managed.session.name = message.name;
    managed.robot.setName(message.name);
    managed.robot.setDisconnected(this.disconnected);

    log.info("renderer_session_applied", {
      action: message.action,
      name: message.name,
      sessionId: message.sessionId,
    });
  }

  setDisconnected(disconnected: boolean): void {
    if (this.disconnected === disconnected) {
      return;
    }

    this.disconnected = disconnected;

    for (const managed of this.robots.values()) {
      managed.robot.setDisconnected(disconnected);
      managed.flames.setRate(disconnected ? 0 : managed.session.tokens.rate);
    }

    log.info("renderer_connection_state", { disconnected });
  }

  tick(deltaMs: number): void {
    if (!this.app || !Number.isFinite(deltaMs) || deltaMs <= 0) {
      return;
    }

    for (const managed of this.robots.values()) {
      managed.robot.update(deltaMs);
      managed.flames.update(deltaMs);
    }

    this.app.render();
  }

  destroy(): void {
    this.lifecycleVersion += 1;

    if (this.animationFrame !== null) {
      cancelAnimationFrame(this.animationFrame);
      this.animationFrame = null;
    }

    for (const managed of this.robots.values()) {
      managed.hitbox.remove();
      managed.flames.destroy();
      managed.robot.destroy();
      managed.wrapper.destroy({ children: true });
    }

    this.robots.clear();
    this.textures.clear();
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
    this.robotLayer = null;
    this.rootElement = null;
    this.tooltipElement = null;
    this.promptPanelElement = null;
    this.promptInputElement = null;
    this.promptSendButtonElement = null;
    this.promptCloseButtonElement = null;
    this.promptFeedbackElement = null;
    this.contextMenuElement = null;
    this.contextMenuTitleElement = null;
    this.contextMenuToggleSizeButtonElement = null;
    this.permissionPopupElement = null;
    this.permissionTitleElement = null;
    this.permissionAllowButtonElement = null;
    this.permissionDenyButtonElement = null;
    this.activePromptSessionId = null;
    this.activePermission = null;
    this.activeTooltipSessionId = null;
    this.activeContextMenuSessionId = null;
    this.maximizedSessionId = null;
    this.floatingUiMode = "none";
    this.windowExpanded = false;
    this.appliedWindowModeKey = null;
    if (this.resizeSettleTimer) {
      clearTimeout(this.resizeSettleTimer);
      this.resizeSettleTimer = null;
    }
    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
      this.tooltipShowTimer = null;
    }
    if (this.tooltipHideTimer) {
      clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }
    this.pendingOperations.length = 0;
    this.initialized = false;
    this.initPromise = null;
    this.disconnected = false;
    this.lastFrameTime = 0;

    log.info("renderer_destroyed");
  }

  private upsertSession(session: SessionInfo): void {
    const existing = this.robots.get(session.sessionId);
    const previousPendingPermission = existing?.session.pendingPermission ?? null;

    const managed = this.ensureRobot(session.sessionId, {
      label: session.label,
      lastResponse: session.lastResponse,
      name: session.name,
      pendingPermission: session.pendingPermission,
      tokens: session.tokens,
    });

    managed.session.name = session.name;
    managed.session.label = session.label;
    managed.session.lastResponse = session.lastResponse;
    managed.session.pendingPermission = session.pendingPermission;
    managed.session.tokens = session.tokens;

    managed.robot.setName(session.name);
    managed.robot.setState(session.state);
    managed.robot.setTokens(session.tokens);
    managed.robot.setDisconnected(this.disconnected);
    managed.flames.setRate(this.disconnected ? 0 : session.tokens.rate);

    this.syncPermissionPopup(session.sessionId, previousPendingPermission, session.pendingPermission);
  }

  private ensureRobot(
    sessionId: string,
    seed: Partial<Omit<SessionSnapshot, "sessionId">> = {},
  ): ManagedRobot {
    const existing = this.robots.get(sessionId);
    if (existing) {
      return existing;
    }

    const wrapper = new Container();
    wrapper.eventMode = "none";

    const robot = new Robot(sessionId, this.textures);
    const flames = new TokenFlameEffect();
    const hitbox = this.createHitbox(sessionId);
    flames.container.scale.set(FLAME_SCALE);
    flames.container.y = FLAME_Y;

    if (seed.name) {
      robot.setName(seed.name);
    }
    robot.setDisconnected(this.disconnected);

    wrapper.addChild(flames.container, robot.container);
    this.robotLayer?.addChild(wrapper);

    const managed: ManagedRobot = {
      createdAt: Date.now(),
      flames,
      hitbox,
      robot,
      session: {
        label: seed.label ?? null,
        lastResponse: seed.lastResponse ?? null,
        name: seed.name ?? "",
        pendingPermission: seed.pendingPermission ?? null,
        sessionId,
        tokens: seed.tokens ?? { total: 0, rate: 0 },
      },
      wrapper,
    };

    this.robots.set(sessionId, managed);
    this.relayout();

    log.info("renderer_robot_added", {
      count: this.robots.size,
      sessionId,
    });

    return managed;
  }

  private removeRobot(sessionId: string, reason: string): void {
    const managed = this.robots.get(sessionId);
    if (!managed) {
      return;
    }

    this.robots.delete(sessionId);

    if (this.activePromptSessionId === sessionId) {
      this.hidePromptPanel();
    }

    if (this.activePermission?.sessionId === sessionId) {
      this.hidePermissionPopup();
    }

    if (this.activeTooltipSessionId === sessionId) {
      this.hideTooltip(true);
    }

    if (this.activeContextMenuSessionId === sessionId) {
      this.hideContextMenu();
    }

    if (this.maximizedSessionId === sessionId) {
      this.maximizedSessionId = null;
      this.updateWindowExpansion();
    }

    this.robotLayer?.removeChild(managed.wrapper);
    managed.hitbox.remove();
    managed.flames.destroy();
    managed.robot.destroy();
    managed.wrapper.destroy({ children: true });
    this.relayout();

    log.info("renderer_robot_removed", {
      count: this.robots.size,
      reason,
      sessionId,
    });
  }

  private relayout(): void {
    if (!this.app) {
      return;
    }

    const ordered = Array.from(this.robots.values()).sort((left, right) => left.createdAt - right.createdAt);
    const contentHeight = ordered.length > 0
      ? ordered.length * LAYOUT.robotSize + (ordered.length - 1) * LAYOUT.robotGap
      : 0;
    const viewportWidth = Math.max(RENDERER_WIDTH, window.innerWidth);
    const viewportHeight = Math.max(
      MIN_CANVAS_HEIGHT,
      window.innerHeight,
      contentHeight + LAYOUT.edgeMargin * 2,
    );
    const baseX = viewportWidth - LAYOUT.edgeMargin - LAYOUT.robotSize;
    const baseY = viewportHeight - LAYOUT.edgeMargin - LAYOUT.robotSize;
    const maximized = this.maximizedSessionId ? this.robots.get(this.maximizedSessionId) ?? null : null;

    if (!maximized && this.maximizedSessionId !== null) {
      this.maximizedSessionId = null;
      this.updateWindowExpansion();
    }

    if (maximized) {
      const maximizedSize = this.getMaximizedRobotSize(viewportWidth, viewportHeight);
      const maximizedScale = maximizedSize / LAYOUT.robotSize;

      ordered.forEach((managed) => {
        if (managed.session.sessionId !== maximized.session.sessionId) {
          this.hideManagedRobot(managed);
          return;
        }

        this.showManagedRobot(managed);
        this.setManagedScale(managed, maximizedScale);
        managed.wrapper.x = viewportWidth - maximizedSize;
        managed.wrapper.y = viewportHeight - maximizedSize;
        this.positionHitbox(managed);
      });
    } else {
      ordered.forEach((managed, index) => {
        this.showManagedRobot(managed);
        this.setManagedScale(managed, 1);
        managed.wrapper.x = baseX;
        managed.wrapper.y = baseY - index * (LAYOUT.robotSize + LAYOUT.robotGap);
        this.positionHitbox(managed);
      });
    }

    if (this.activePromptSessionId) {
      const managed = this.robots.get(this.activePromptSessionId);
      if (managed && this.promptPanelElement) {
        this.positionPanelNearRobot(this.promptPanelElement, managed);
      }
    }

    if (this.activePermission) {
      const managed = this.robots.get(this.activePermission.sessionId);
      if (managed && this.permissionPopupElement) {
        this.positionPanelNearRobot(this.permissionPopupElement, managed);
      }
    }

    if (this.activeTooltipSessionId) {
      const managed = this.robots.get(this.activeTooltipSessionId);
      if (managed && this.tooltipElement) {
        this.positionTooltipNearRobot(this.tooltipElement, managed);
      }
    }

    if (this.activeContextMenuSessionId) {
      const managed = this.robots.get(this.activeContextMenuSessionId);
      if (managed && this.contextMenuElement) {
        this.positionContextMenuNearRobot(this.contextMenuElement, managed);
      }
    }

    this.app.renderer.resize(viewportWidth, viewportHeight);

    log.debug("renderer_relayout", {
      viewportHeight,
      viewportWidth,
      count: ordered.length,
    });
  }

  private runOrQueue(operation: () => void): boolean {
    if (this.initialized) {
      return true;
    }

    this.pendingOperations.push(operation);
    return false;
  }

  private flushPendingOperations(): void {
    while (this.pendingOperations.length > 0) {
      const operation = this.pendingOperations.shift();
      operation?.();
    }
  }

  private startAnimationLoop(): void {
    if (this.animationFrame !== null) {
      return;
    }

    const step = (time: number) => {
      if (!this.initialized) {
        this.animationFrame = null;
        return;
      }

      const deltaMs = this.lastFrameTime === 0 ? 16.67 : Math.max(0, time - this.lastFrameTime);
      this.lastFrameTime = time;
      this.tick(deltaMs);
      this.animationFrame = requestAnimationFrame(step);
    };

    this.lastFrameTime = 0;
    this.animationFrame = requestAnimationFrame(step);
  }

  private createHitbox(sessionId: string): HTMLDivElement {
    const hitbox = document.createElement("div");
    hitbox.dataset.sessionId = sessionId;
    hitbox.style.position = "fixed";
    hitbox.style.width = `${LAYOUT.robotSize}px`;
    hitbox.style.height = `${LAYOUT.robotSize}px`;
    hitbox.style.pointerEvents = "auto";
    hitbox.style.background = "transparent";
    hitbox.style.zIndex = "9998";

    hitbox.addEventListener("pointerenter", () => {
      this.showTooltip(sessionId);
    });
    hitbox.addEventListener("pointermove", () => {
      this.showTooltip(sessionId);
    });
    hitbox.addEventListener("pointerleave", () => {
      this.hideTooltip();
    });
    hitbox.addEventListener("click", () => {
      this.hideContextMenu();
      this.togglePromptPanel(sessionId);
    });
    hitbox.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.hideTooltip(true);
      this.showContextMenu(sessionId, event.clientX, event.clientY);
    });

    this.rootElement?.appendChild(hitbox);
    return hitbox;
  }

  private positionHitbox(managed: ManagedRobot): void {
    if (!managed.wrapper.visible) {
      managed.hitbox.style.display = "none";
      return;
    }

    const size = this.getManagedRobotSize(managed);
    managed.hitbox.style.display = "block";
    managed.hitbox.style.width = `${size}px`;
    managed.hitbox.style.height = `${size}px`;
    managed.hitbox.style.left = `${managed.wrapper.x}px`;
    managed.hitbox.style.top = `${managed.wrapper.y}px`;
  }

  private showTooltip(sessionId: string): void {
    const tooltip = this.tooltipElement;
    const managed = this.robots.get(sessionId);
    if (!tooltip || !managed) {
      return;
    }

    if (this.floatingUiMode !== "none" && this.floatingUiMode !== "tooltip") {
      return;
    }

    if (this.tooltipHideTimer) {
      clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }

    if (this.activeTooltipSessionId === sessionId && tooltip.style.display === "block") {
      this.positionTooltipNearRobot(tooltip, managed);
      return;
    }

    if (this.activeTooltipSessionId === sessionId && this.tooltipShowTimer) {
      return;
    }

    const displayName = this.getDisplayName(managed);
    const lastResponse = this.getTooltipLastResponse(managed.session.lastResponse);
    const lastResponseHtml = lastResponse ? renderTooltipMarkdown(lastResponse) : null;
    const lastResponseLine = lastResponse
      ? `<span class="last-response" aria-label="last response">${lastResponseHtml}</span>`
      : "";

    tooltip.innerHTML = `<strong>${escapeHtml(displayName)}</strong>${lastResponseLine}`;
    tooltip.style.display = "none";
    tooltip.setAttribute("aria-hidden", "true");

    const wasExpanded = this.windowExpanded;
    this.activeTooltipSessionId = sessionId;
    this.floatingUiMode = "tooltip";
    this.updateWindowExpansion();

    const showResolvedTooltip = () => {
      this.tooltipShowTimer = null;
      if (this.activeTooltipSessionId !== sessionId || !this.tooltipElement) {
        return;
      }
      const liveManaged = this.robots.get(sessionId);
      if (!liveManaged) {
        return;
      }

      this.positionTooltipNearRobot(this.tooltipElement, liveManaged);
      this.tooltipElement.style.display = "block";
      this.tooltipElement.setAttribute("aria-hidden", "false");
    };

    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
      this.tooltipShowTimer = null;
    }

    this.tooltipShowTimer = setTimeout(
      showResolvedTooltip,
      wasExpanded ? 0 : TOOLTIP_SHOW_DELAY_MS,
    );
  }

  private hideTooltip(immediate = false, suppressUpdate = false): void {
    const tooltip = this.tooltipElement;
    if (!tooltip) {
      return;
    }

    if (this.tooltipShowTimer) {
      clearTimeout(this.tooltipShowTimer);
      this.tooltipShowTimer = null;
    }

    if (this.tooltipHideTimer) {
      clearTimeout(this.tooltipHideTimer);
      this.tooltipHideTimer = null;
    }

    if (immediate) {
      tooltip.style.display = "none";
      tooltip.setAttribute("aria-hidden", "true");
      this.activeTooltipSessionId = null;
      if (this.floatingUiMode === "tooltip") {
        this.floatingUiMode = "none";
      }
      if (!suppressUpdate) {
        this.updateWindowExpansion();
      }
      return;
    }

    this.tooltipHideTimer = setTimeout(() => {
      this.tooltipHideTimer = null;
      if (!this.tooltipElement) {
        return;
      }

      this.tooltipElement.style.display = "none";
      this.tooltipElement.setAttribute("aria-hidden", "true");
      this.activeTooltipSessionId = null;
      if (this.floatingUiMode === "tooltip") {
        this.floatingUiMode = "none";
      }
      if (!suppressUpdate) {
        this.updateWindowExpansion();
      }
    }, TOOLTIP_HIDE_DELAY_MS);
  }

  showPromptResult(result: CommandResult): void {
    if (result.success) {
      this.setPromptFeedback("Sent", false);
      return;
    }

    this.setPromptFeedback(result.error ?? "Failed to send command", true);
    window.setTimeout(() => {
      this.setPromptFeedback(null, false);
    }, 3000);
  }

  private togglePromptPanel(sessionId: string): void {
    if (this.activePromptSessionId === sessionId) {
      this.hidePromptPanel();
      return;
    }

    if (this.activePermission?.sessionId === sessionId) {
      return;
    }

    this.showPromptPanel(sessionId);
  }

  private showPromptPanel(sessionId: string): void {
    const panel = this.promptPanelElement;
    const input = this.promptInputElement;
    if (!panel || !input) {
      return;
    }

    if (this.activePermission !== null) {
      return;
    }

    const managed = this.robots.get(sessionId);
    if (!managed) {
      return;
    }

    this.hideContextMenu(true);
    this.hideTooltip(true, true);
    this.activePromptSessionId = sessionId;
    this.floatingUiMode = "prompt";
    this.positionPanelNearRobot(panel, managed);
    panel.style.display = "block";
    panel.classList.add("visible");
    this.setPromptFeedback(null, false);
    this.updateWindowExpansion();

    window.setTimeout(() => {
      input.focus();
    }, 0);
  }

  private hidePromptPanel(suppressUpdate = false): void {
    const panel = this.promptPanelElement;
    if (!panel) {
      this.activePromptSessionId = null;
      if (this.floatingUiMode === "prompt") {
        this.floatingUiMode = "none";
      }
      if (!suppressUpdate) {
        this.updateWindowExpansion();
      }
      return;
    }

    panel.classList.remove("visible");
    panel.style.display = "none";
    this.activePromptSessionId = null;
    if (this.floatingUiMode === "prompt") {
      this.floatingUiMode = "none";
    }
    this.setPromptFeedback(null, false);
    if (!suppressUpdate) {
      this.updateWindowExpansion();
    }
  }

  private submitPrompt(): void {
    const sessionId = this.activePromptSessionId;
    const input = this.promptInputElement;
    if (!sessionId || !input) {
      return;
    }

    const text = input.value.trim();
    if (text.length === 0) {
      return;
    }

    this.onPrompt?.(sessionId, text);
    input.value = "";
    this.hidePromptPanel();
  }

  private setPromptFeedback(message: string | null, isError: boolean): void {
    const feedback = this.promptFeedbackElement;
    if (!feedback) {
      return;
    }

    if (!message) {
      feedback.textContent = "";
      feedback.classList.remove("error");
      return;
    }

    feedback.textContent = message;
    feedback.classList.toggle("error", isError);
  }

  private syncPermissionPopup(
    sessionId: string,
    previous: SessionSnapshot["pendingPermission"],
    next: SessionSnapshot["pendingPermission"],
  ): void {
    if (next && (!previous || previous.permissionId !== next.permissionId)) {
      this.showPermissionPopup(sessionId, next.permissionId, next.title);
      return;
    }

    if (!next && this.activePermission?.sessionId === sessionId) {
      this.hidePermissionPopup();
    }
  }

  private showPermissionPopup(sessionId: string, permissionId: string, title: string): void {
    const popup = this.permissionPopupElement;
    const titleElement = this.permissionTitleElement;
    if (!popup || !titleElement) {
      return;
    }

    const managed = this.robots.get(sessionId);
    if (!managed) {
      return;
    }

    if (this.activePromptSessionId === sessionId) {
      this.hidePromptPanel(true);
    }

    this.hideContextMenu(true);
    this.hideTooltip(true, true);
    this.activePermission = { sessionId, permissionId };
    this.floatingUiMode = "permission";
    titleElement.textContent = title;
    this.positionPanelNearRobot(popup, managed);
    popup.style.display = "block";
    popup.classList.add("visible");
    this.updateWindowExpansion();
  }

  private hidePermissionPopup(suppressUpdate = false): void {
    const popup = this.permissionPopupElement;
    if (popup) {
      popup.classList.remove("visible");
      popup.style.display = "none";
    }

    this.activePermission = null;
    if (this.floatingUiMode === "permission") {
      this.floatingUiMode = "none";
    }
    if (!suppressUpdate) {
      this.updateWindowExpansion();
    }
  }

  private submitPermissionReply(allow: boolean): void {
    const active = this.activePermission;
    if (!active) {
      return;
    }

    this.onPermissionReply?.(active.sessionId, active.permissionId, allow);
  }

  private showContextMenu(sessionId: string, _anchorX: number, _anchorY: number): void {
    const menu = this.contextMenuElement;
    const title = this.contextMenuTitleElement;
    const toggleButton = this.contextMenuToggleSizeButtonElement;
    const managed = this.robots.get(sessionId);
    if (!menu || !title || !toggleButton || !managed) {
      return;
    }

    if (this.activePermission !== null) {
      return;
    }

    this.hidePromptPanel(true);
    this.hideTooltip(true, true);

    this.activeContextMenuSessionId = sessionId;
    this.floatingUiMode = "context-menu";
    title.textContent = this.getDisplayName(managed);
    toggleButton.textContent = this.isSessionMaximized(sessionId) ? "Restore Robot Size" : "Maximize Robot";
    menu.style.display = "block";
    menu.classList.add("visible");
    this.positionContextMenuNearRobot(menu, managed);
    this.updateWindowExpansion();
  }

  private hideContextMenu(suppressUpdate = false): void {
    const menu = this.contextMenuElement;
    if (menu) {
      menu.classList.remove("visible");
      menu.style.display = "none";
    }

    this.activeContextMenuSessionId = null;
    if (this.floatingUiMode === "context-menu") {
      this.floatingUiMode = "none";
    }
    if (!suppressUpdate) {
      this.updateWindowExpansion();
    }
  }

  private toggleMaximizedSession(sessionId: string): void {
    const nextSessionId = this.maximizedSessionId === sessionId ? null : sessionId;

    this.hideContextMenu(true);
    this.hideTooltip(true, true);
    this.hidePromptPanel(true);

    if (this.activePermission && nextSessionId !== this.activePermission.sessionId) {
      this.hidePermissionPopup(true);
    }

    this.maximizedSessionId = nextSessionId;
    this.updateWindowExpansion();
    this.relayout();

    log.info("renderer_maximized_session_toggled", {
      maximized: nextSessionId === sessionId,
      sessionId,
    });
  }

  private positionPanelNearRobot(panel: HTMLElement, managed: ManagedRobot): void {
    const margin = 8;
    const gap = 12;
    const isPromptPanel = panel.id === "prompt-panel";
    const leftBias = isPromptPanel ? PROMPT_PANEL_LEFT_BIAS : 0;
    const robotSize = this.getManagedRobotSize(managed);

    if (isPromptPanel) {
      const maxSpace = Math.max(120, Math.floor(managed.wrapper.x - gap - margin));
      const effectiveBias = Math.min(leftBias, Math.max(0, maxSpace - PROMPT_MAX_WIDTH));
      const targetWidth = Math.max(120, Math.min(PROMPT_MAX_WIDTH, maxSpace - effectiveBias));
      panel.style.width = `${targetWidth}px`;
      panel.style.maxWidth = `${targetWidth}px`;
    }

    panel.style.left = "-9999px";
    panel.style.top = "0px";
    panel.style.display = "block";

    const panelWidth = panel.offsetWidth;
    const panelHeight = panel.offsetHeight;
    const maxLeft = Math.max(margin, window.innerWidth - panelWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - panelHeight - margin);

    const preferredLeft = managed.wrapper.x - panelWidth - gap - leftBias;
    const fallbackRight = managed.wrapper.x + robotSize + gap;
    const left = isPromptPanel
      ? Math.min(maxLeft, Math.max(margin, preferredLeft))
      : Math.min(maxLeft, Math.max(margin, preferredLeft < margin ? fallbackRight : preferredLeft));

    const centeredTop = managed.wrapper.y + robotSize / 2 - panelHeight / 2;
    const top = Math.min(maxTop, Math.max(margin, centeredTop));

    panel.style.left = `${left}px`;
    panel.style.top = `${top}px`;
  }

  private updateWindowExpansion(): void {
    const nextModeKey = this.getWindowModeKey();
    if (nextModeKey === this.appliedWindowModeKey) {
      return;
    }

    this.appliedWindowModeKey = nextModeKey;
    this.windowExpanded = nextModeKey !== "default";

    if (nextModeKey.startsWith("maximized:")) {
      void this.invokeTauri("maximize_window", { size: this.getMaximizedWindowSize() });
    } else if (nextModeKey.startsWith("expanded:")) {
      void this.invokeTauri("expand_window", { width: EXPANDED_OVERLAY_WIDTH });
    } else {
      void this.invokeTauri("restore_window");
    }

    this.scheduleFloatingReposition();
  }

  private scheduleFloatingReposition(): void {
    if (this.resizeSettleTimer) {
      clearTimeout(this.resizeSettleTimer);
    }

    this.resizeSettleTimer = setTimeout(() => {
      this.resizeSettleTimer = null;
      this.relayout();
    }, 120);
  }

  private async invokeTauri(command: string, args?: Record<string, unknown>): Promise<void> {
    try {
      if (!tauriInvoke) {
        try {
          const module = await import("@tauri-apps/api/core");
          if (typeof module.invoke === "function") {
            tauriInvoke = module.invoke;
          }
        } catch {
          // Fallback to global bridge below.
        }

        if (!tauriInvoke) {
          const tauri = (window as unknown as {
            __TAURI__?: {
              core?: {
                invoke?: (cmd: string, payload?: Record<string, unknown>) => Promise<unknown>;
              };
            };
          }).__TAURI__;

          if (typeof tauri?.core?.invoke === "function") {
            tauriInvoke = tauri.core.invoke;
          }
        }
      }

      if (!tauriInvoke) {
        log.warn("window_resize_invoke_unavailable", { command });
        return;
      }

      await tauriInvoke(command, args);
    } catch (error) {
      log.warn("window_resize_invoke_failed", {
        command,
        error: String(error),
      });
    }
  }

  private getTooltipLastResponse(lastResponse: string | null): string | null {
    if (!lastResponse) {
      return null;
    }

    const normalized = lastResponse
      .replaceAll("\r\n", "\n")
      .replaceAll("\r", "\n")
      .trim();
    if (normalized.length === 0) {
      return null;
    }

    return normalized.length > 320 ? `${normalized.slice(0, 320)}…` : normalized;
  }

  private positionTooltipNearRobot(tooltip: HTMLElement, managed: ManagedRobot): void {
    const margin = 8;
    const anchorX = managed.wrapper.x;
    const robotSize = this.getManagedRobotSize(managed);

    const maxSpace = Math.max(120, Math.floor(anchorX - TOOLTIP_GAP - margin));
    const effectiveBias = Math.min(TOOLTIP_LEFT_BIAS, Math.max(0, maxSpace - TOOLTIP_MAX_WIDTH));
    const targetWidth = Math.max(120, Math.min(TOOLTIP_MAX_WIDTH, maxSpace - effectiveBias));
    tooltip.style.width = `${targetWidth}px`;
    tooltip.style.maxWidth = `${targetWidth}px`;

    tooltip.style.left = "-9999px";
    tooltip.style.top = "0px";
    tooltip.style.display = "block";

    const tooltipWidth = tooltip.offsetWidth;
    const tooltipHeight = tooltip.offsetHeight;
    const maxLeft = Math.max(margin, window.innerWidth - tooltipWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - tooltipHeight - margin);

    const anchorY = managed.wrapper.y + robotSize / 2;

    const preferredLeft = anchorX - tooltipWidth - TOOLTIP_GAP - effectiveBias;
    const left = Math.min(maxLeft, Math.max(margin, preferredLeft));

    const centeredTop = anchorY - tooltipHeight / 2;
    const top = Math.min(maxTop, Math.max(margin, centeredTop));

    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  private getDisplayName(managed: ManagedRobot): string {
    return managed.session.name.trim() || managed.session.sessionId;
  }

  private setManagedScale(managed: ManagedRobot, scale: number): void {
    managed.wrapper.scale.set(scale);
  }

  private showManagedRobot(managed: ManagedRobot): void {
    managed.wrapper.visible = true;
    managed.hitbox.style.display = "block";
  }

  private hideManagedRobot(managed: ManagedRobot): void {
    managed.wrapper.visible = false;
    managed.hitbox.style.display = "none";
  }

  private getManagedRobotSize(managed: ManagedRobot): number {
    return Math.max(LAYOUT.robotSize, Math.round(LAYOUT.robotSize * managed.wrapper.scale.x));
  }

  private getMaximizedRobotSize(viewportWidth: number, viewportHeight: number): number {
    return Math.max(LAYOUT.robotSize, Math.min(viewportWidth, viewportHeight));
  }

  private getMaximizedWindowSize(): number {
    const screenHeight = Number.isFinite(window.screen?.availHeight) ? window.screen.availHeight : window.innerHeight;
    return Math.max(LAYOUT.robotSize, Math.floor(screenHeight));
  }

  private isSessionMaximized(sessionId: string): boolean {
    return this.maximizedSessionId === sessionId;
  }

  private getWindowModeKey(): string {
    if (this.maximizedSessionId) {
      return `maximized:${this.getMaximizedWindowSize()}`;
    }

    if (this.floatingUiMode !== "none") {
      return `expanded:${EXPANDED_OVERLAY_WIDTH}`;
    }

    return "default";
  }

  private positionContextMenuNearRobot(menu: HTMLElement, managed: ManagedRobot): void {
    const margin = 8;
    const gap = 12;
    const robotSize = this.getManagedRobotSize(managed);

    menu.style.left = "-9999px";
    menu.style.top = "0px";

    const menuWidth = menu.offsetWidth;
    const menuHeight = menu.offsetHeight;
    const maxLeft = Math.max(margin, window.innerWidth - menuWidth - margin);
    const maxTop = Math.max(margin, window.innerHeight - menuHeight - margin);
    const preferredLeft = managed.wrapper.x - menuWidth - gap;
    const fallbackRight = managed.wrapper.x + robotSize + gap;
    const left = Math.min(maxLeft, Math.max(margin, preferredLeft < margin ? fallbackRight : preferredLeft));
    const centeredTop = managed.wrapper.y + robotSize / 2 - menuHeight / 2;
    const top = Math.min(maxTop, Math.max(margin, centeredTop));

    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  private getTooltipText(managed: ManagedRobot): string {
    const displayName = managed.session.name.trim() || managed.session.sessionId;
    return `${displayName}\n${managed.session.sessionId}`;
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function renderTooltipMarkdown(value: string): string {
  const escaped = escapeHtml(value);
  const codeSpans: string[] = [];

  let working = escaped.replace(/`([^`\n]+)`/g, (_match, code) => {
    const index = codeSpans.push(code) - 1;
    return `@@CODE_${index}@@`;
  });

  working = working
    .replace(/^#{1,6}\s+(.+)$/gm, "<strong>$1</strong>")
    .replace(/^(?:-|\*)\s+(.+)$/gm, "• $1")
    .replace(/\*\*([^\n*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/__([^\n_]+)__/g, "<strong>$1</strong>")
    .replace(/~~([^\n~]+)~~/g, "<s>$1</s>")
    .replace(/(^|[^*])\*([^\n*]+)\*(?!\*)/g, "$1<em>$2</em>")
    .replace(/(^|[^_])_([^\n_]+)_(?!_)/g, "$1<em>$2</em>");

  working = working.replace(/@@CODE_(\d+)@@/g, (_match, rawIndex) => {
    const index = Number(rawIndex);
    const code = codeSpans[index] ?? "";
    return `<code>${code}</code>`;
  });

  return working.replaceAll("\n", "<br />");
}
