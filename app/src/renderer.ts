import { Application, Container, Texture } from "pixi.js";

import type {
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

type SessionSnapshot = {
  sessionId: string;
  name: string;
  label: string | null;
  tokens: TokenData;
};

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
    this.pendingOperations.length = 0;
    this.initialized = false;
    this.initPromise = null;
    this.disconnected = false;
    this.lastFrameTime = 0;

    log.info("renderer_destroyed");
  }

  private upsertSession(session: SessionInfo): void {
    const managed = this.ensureRobot(session.sessionId, {
      label: session.label,
      name: session.name,
      tokens: session.tokens,
    });

    managed.session.name = session.name;
    managed.session.label = session.label;
    managed.session.tokens = session.tokens;

    managed.robot.setName(session.name);
    managed.robot.setState(session.state);
    managed.robot.setTokens(session.tokens);
    managed.robot.setDisconnected(this.disconnected);
    managed.flames.setRate(this.disconnected ? 0 : session.tokens.rate);
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
        name: seed.name ?? "",
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

    ordered.forEach((managed, index) => {
      managed.wrapper.x = baseX;
      managed.wrapper.y = baseY - index * (LAYOUT.robotSize + LAYOUT.robotGap);
      this.positionHitbox(managed);
    });

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

    hitbox.addEventListener("pointerenter", (event) => {
      this.showTooltip(sessionId, event.clientX, event.clientY);
    });
    hitbox.addEventListener("pointermove", (event) => {
      this.showTooltip(sessionId, event.clientX, event.clientY);
    });
    hitbox.addEventListener("pointerleave", () => {
      this.hideTooltip();
    });

    this.rootElement?.appendChild(hitbox);
    return hitbox;
  }

  private positionHitbox(managed: ManagedRobot): void {
    managed.hitbox.style.left = `${managed.wrapper.x}px`;
    managed.hitbox.style.top = `${managed.wrapper.y}px`;
  }

  private showTooltip(sessionId: string, clientX: number, clientY: number): void {
    const tooltip = this.tooltipElement;
    const managed = this.robots.get(sessionId);
    if (!tooltip || !managed) {
      return;
    }

    const displayName = this.getDisplayName(managed);
    tooltip.innerHTML = `<strong>${escapeHtml(displayName)}</strong><span>${escapeHtml(managed.session.sessionId)}</span>`;
    tooltip.style.display = "block";
    tooltip.setAttribute("aria-hidden", "false");

    const left = Math.max(8, clientX - tooltip.offsetWidth - 12);
    const top = Math.max(8, clientY - tooltip.offsetHeight / 2);
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
  }

  private hideTooltip(): void {
    const tooltip = this.tooltipElement;
    if (!tooltip) {
      return;
    }

    tooltip.style.display = "none";
    tooltip.setAttribute("aria-hidden", "true");
  }

  private getDisplayName(managed: ManagedRobot): string {
    return managed.session.name.trim() || managed.session.sessionId;
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
