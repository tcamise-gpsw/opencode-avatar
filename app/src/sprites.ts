import { Container, Graphics, Rectangle, Texture } from "pixi.js";

import { createLogger } from "./logger.js";

const log = createLogger("sprites");

export const FRAME_SIZE = 32;

const FACE_WIDTH = 14;
const FACE_HEIGHT = 10;

const COLORS = {
  body: 0x64748b,
  bodyDark: 0x334155,
  screen: 0x0f172a,
  screenBorder: 0x475569,
  green: 0x4ade80,
  yellow: 0xfacc15,
  red: 0xf87171,
  orange: 0xf97316,
  white: 0xffffff,
  grey: 0x94a3b8,
} as const;

type TextureGenerationOptions = {
  target: Container;
  frame?: Rectangle;
  resolution?: number;
  antialias?: boolean;
};

type TextureRenderer = {
  generateTexture: (options: TextureGenerationOptions | Container) => Texture;
};

function px(g: Graphics, x: number, y: number, w: number, h: number, color: number): void {
  g.rect(x, y, w, h).fill(color);
}

function generateTexture(renderer: TextureRenderer, drawFn: (g: Graphics) => void, frame: Rectangle): Texture {
  const container = new Container();
  const graphics = new Graphics();

  drawFn(graphics);
  container.addChild(graphics);

  const texture = renderer.generateTexture({
    target: container,
    frame,
    resolution: 1,
    antialias: false,
  });

  texture.source.scaleMode = "nearest";
  texture.source.style.update();

  return texture;
}

function drawBaseBody(g: Graphics, xOffset = 0, yOffset = 0, armOffset = 0): void {
  const x = xOffset;
  const y = yOffset;

  px(g, x + 15, y + 0, 2, 4, COLORS.green);
  px(g, x + 14, y + 0, 4, 2, COLORS.green);

  px(g, x + 8, y + 4, 16, 12, COLORS.bodyDark);
  px(g, x + 9, y + 5, 14, 10, COLORS.body);
  px(g, x + 10, y + 6, 12, 8, COLORS.screenBorder);
  px(g, x + 11, y + 7, 10, 6, COLORS.screen);

  px(g, x + 10, y + 18, 12, 8, COLORS.bodyDark);
  px(g, x + 11, y + 19, 10, 6, COLORS.body);

  px(g, x + 13, y + 20, 2, 2, COLORS.green);
  px(g, x + 16, y + 20, 2, 2, COLORS.yellow);
  px(g, x + 19, y + 20, 2, 2, COLORS.red);
  px(g, x + 15, y + 23, 2, 1, COLORS.orange);

  px(g, x + 5, y + 18 + armOffset, 4, 2, COLORS.bodyDark);
  px(g, x + 23, y + 18 + armOffset, 4, 2, COLORS.bodyDark);
  px(g, x + 6, y + 20 + armOffset, 3, 4, COLORS.body);
  px(g, x + 23, y + 20 + armOffset, 3, 4, COLORS.body);

  px(g, x + 12, y + 27, 3, 4, COLORS.bodyDark);
  px(g, x + 18, y + 27, 3, 4, COLORS.bodyDark);
  px(g, x + 10, y + 30, 5, 2, COLORS.body);
  px(g, x + 17, y + 30, 5, 2, COLORS.body);
}

export function generateSpriteTextures(app: { renderer: TextureRenderer }): Map<string, Texture> {
  const textures = new Map<string, Texture>();

  log.info("generating_sprites", {
    frameSize: FRAME_SIZE,
    faceWidth: FACE_WIDTH,
    faceHeight: FACE_HEIGHT,
  });

  const bodyFrame = new Rectangle(0, 0, FRAME_SIZE, FRAME_SIZE);
  const faceFrame = new Rectangle(0, 0, FACE_WIDTH, FACE_HEIGHT);

  function makeFace(name: string, drawFn: (g: Graphics) => void): void {
    textures.set(name, generateTexture(app.renderer, drawFn, faceFrame));
  }

  function makeBody(name: string, drawFn: (g: Graphics) => void): void {
    textures.set(name, generateTexture(app.renderer, drawFn, bodyFrame));
  }

  makeFace("face-neutral", (g) => {
    px(g, 2, 2, 3, 3, COLORS.green);
    px(g, 9, 2, 3, 3, COLORS.green);
    px(g, 4, 7, 6, 1, COLORS.green);
  });

  makeFace("face-dots", (g) => {
    px(g, 2, 4, 2, 2, COLORS.green);
    px(g, 6, 4, 2, 2, COLORS.green);
    px(g, 10, 4, 2, 2, COLORS.green);
  });

  makeFace("face-scan", (g) => {
    px(g, 1, 2, 4, 3, COLORS.green);
    px(g, 8, 2, 4, 3, COLORS.green);
    px(g, 4, 3, 1, 1, COLORS.screen);
    px(g, 11, 3, 1, 1, COLORS.screen);
  });

  makeFace("face-focused", (g) => {
    px(g, 2, 2, 3, 3, COLORS.green);
    px(g, 9, 3, 3, 1, COLORS.green);
    px(g, 4, 7, 6, 1, COLORS.green);
  });

  makeFace("face-question", (g) => {
    px(g, 5, 1, 4, 1, COLORS.yellow);
    px(g, 9, 2, 1, 2, COLORS.yellow);
    px(g, 6, 4, 3, 1, COLORS.yellow);
    px(g, 6, 5, 1, 1, COLORS.yellow);
    px(g, 6, 7, 1, 1, COLORS.yellow);
  });

  makeFace("face-x-eyes", (g) => {
    px(g, 2, 2, 1, 1, COLORS.red);
    px(g, 4, 2, 1, 1, COLORS.red);
    px(g, 3, 3, 1, 1, COLORS.red);
    px(g, 2, 4, 1, 1, COLORS.red);
    px(g, 4, 4, 1, 1, COLORS.red);

    px(g, 9, 2, 1, 1, COLORS.red);
    px(g, 11, 2, 1, 1, COLORS.red);
    px(g, 10, 3, 1, 1, COLORS.red);
    px(g, 9, 4, 1, 1, COLORS.red);
    px(g, 11, 4, 1, 1, COLORS.red);

    px(g, 4, 7, 6, 1, COLORS.red);
  });

  makeFace("face-excited", (g) => {
    px(g, 2, 2, 3, 3, COLORS.green);
    px(g, 9, 2, 3, 3, COLORS.green);
    px(g, 3, 3, 1, 1, COLORS.white);
    px(g, 10, 3, 1, 1, COLORS.white);
    px(g, 4, 6, 6, 2, COLORS.green);
    px(g, 5, 6, 4, 1, COLORS.screen);
  });

  makeFace("face-sleeping", (g) => {
    px(g, 2, 3, 3, 1, COLORS.grey);
    px(g, 9, 3, 3, 1, COLORS.grey);
    px(g, 11, 0, 2, 1, COLORS.grey);
    px(g, 12, 1, 1, 1, COLORS.grey);
    px(g, 11, 2, 2, 1, COLORS.grey);
  });

  for (let index = 0; index < 4; index += 1) {
    const yOffset = index < 2 ? 0 : 1;
    makeBody(`body-idle-${index}`, (g) => drawBaseBody(g, 0, yOffset));
  }

  for (let index = 0; index < 4; index += 1) {
    const armOffset = index % 2 === 0 ? 0 : -1;
    makeBody(`body-typing-${index}`, (g) => drawBaseBody(g, 0, 0, armOffset));
  }

  makeBody("body-vibrate-0", (g) => drawBaseBody(g));
  makeBody("body-vibrate-1", (g) => drawBaseBody(g, 1));
  makeBody("body-slump-0", (g) => drawBaseBody(g, 0, 2));

  log.info("sprites_generated", { count: textures.size });

  return textures;
}
