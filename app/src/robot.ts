import { Container, Sprite, Texture } from "pixi.js";

import type { AvatarState, TokenData } from "@opencode-avatar/shared";

import { createLogger } from "./logger.js";
import { FRAME_SIZE } from "./sprites.js";
import { LAYOUT, STATE_ANIMATIONS } from "./types.js";

const log = createLogger("robot");

const SCALE = LAYOUT.robotSize / FRAME_SIZE;
const DISCONNECTED_ALPHA = 0.45;
const DISCONNECTED_TINT = 0xa3a3a3;

const BODY_ANIMATION_TEXTURES: Record<string, string> = {
  breathe: "idle",
  idle: "idle",
  lean: "idle",
  tap: "typing",
  typing: "typing",
  vibrate: "vibrate",
  slump: "slump",
};

export class Robot {
  public readonly container: Container;
  public readonly sessionId: string;
  public sessionName = "";

  private readonly bodySprite: Sprite;
  private readonly faceSprite: Sprite;
  private readonly textures: Map<string, Texture>;

  private currentState: AvatarState = "idle";
  private animFrame = 0;
  private animTimer = 0;
  private tokens: TokenData = { total: 0, rate: 0 };
  private disconnected = false;

  constructor(sessionId: string, textures: Map<string, Texture>) {
    this.sessionId = sessionId;
    this.textures = textures;

    this.container = new Container();
    this.container.scale.set(SCALE);

    this.bodySprite = new Sprite(this.getTexture("body-idle-0"));
    this.faceSprite = new Sprite(this.getTexture("face-neutral"));
    this.bodySprite.roundPixels = true;
    this.faceSprite.roundPixels = true;
    this.faceSprite.position.set(9, 5);

    this.container.addChild(this.bodySprite, this.faceSprite);

    this.updateSprites();

    log.info("robot_created", { sessionId });
  }

  setState(state: AvatarState): void {
    if (state === this.currentState) {
      return;
    }

    log.debug("robot_state_change", {
      sessionId: this.sessionId,
      from: this.currentState,
      to: state,
    });

    this.currentState = state;
    this.animFrame = 0;
    this.animTimer = 0;
    this.updateSprites();
  }

  setTokens(tokens: TokenData): void {
    this.tokens = tokens;
  }

  setName(name: string): void {
    this.sessionName = name;
  }

  setDisconnected(disconnected: boolean): void {
    if (this.disconnected === disconnected) {
      return;
    }

    this.disconnected = disconnected;
    this.container.alpha = disconnected ? DISCONNECTED_ALPHA : 1;

    const tint = disconnected ? DISCONNECTED_TINT : 0xffffff;
    this.bodySprite.tint = tint;
    this.faceSprite.tint = tint;

    this.updateSprites();

    log.info("robot_disconnected_state", { sessionId: this.sessionId, disconnected });
  }

  update(deltaMs: number): void {
    if (this.disconnected) {
      return;
    }

    const config = STATE_ANIMATIONS[this.currentState];
    const frameCount = this.getBodyFrameCount(config.bodyAnim);
    if (frameCount <= 1) {
      return;
    }

    const frameDuration = 1000 / config.fps;
    this.animTimer += deltaMs;

    let advanced = false;
    while (this.animTimer >= frameDuration) {
      this.animTimer -= frameDuration;
      this.animFrame = (this.animFrame + 1) % frameCount;
      advanced = true;
    }

    if (advanced) {
      this.updateSprites();
    }
  }

  destroy(): void {
    this.container.destroy({ children: true });
    log.info("robot_destroyed", { sessionId: this.sessionId });
  }

  private updateSprites(): void {
    const config = STATE_ANIMATIONS[this.currentState];
    const bodyTextureKey = this.getBodyTextureKey(config.bodyAnim, this.animFrame);
    const faceTextureKey = this.disconnected ? "face-sleeping" : `face-${config.faceFrame}`;

    this.bodySprite.texture = this.getTexture(bodyTextureKey, "body-idle-0");
    this.faceSprite.texture = this.getTexture(faceTextureKey, "face-neutral");
  }

  private getBodyTextureKey(bodyAnim: string, frame: number): string {
    const textureName = BODY_ANIMATION_TEXTURES[bodyAnim] ?? "idle";
    const frameCount = this.getBodyFrameCount(bodyAnim);
    const safeFrame = frameCount <= 1 ? 0 : frame % frameCount;

    return `body-${textureName}-${safeFrame}`;
  }

  private getBodyFrameCount(bodyAnim: string): number {
    if (bodyAnim === "idle") {
      return 1;
    }

    const textureName = BODY_ANIMATION_TEXTURES[bodyAnim] ?? "idle";

    let count = 0;
    while (this.textures.has(`body-${textureName}-${count}`)) {
      count += 1;
    }

    return count > 0 ? count : 1;
  }

  private getTexture(name: string, fallback?: string): Texture {
    const texture = this.textures.get(name);
    if (texture) {
      return texture;
    }

    if (fallback) {
      const fallbackTexture = this.textures.get(fallback);
      if (fallbackTexture) {
        log.warn("robot_texture_fallback", { sessionId: this.sessionId, name, fallback });
        return fallbackTexture;
      }
    }

    log.warn("robot_texture_missing", { sessionId: this.sessionId, name, fallback });
    return Texture.EMPTY;
  }
}
