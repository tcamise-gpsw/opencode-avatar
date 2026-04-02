import { Container, Sprite, Texture } from "pixi.js";

import { createLogger } from "./logger.js";

const log = createLogger("flames");

const DEFAULT_MAX_RATE = 160;
const EMITTER_X = 16;
const EMITTER_Y = 30;
const MAX_PARTICLES = 20;
const INTENSITY_EPSILON = 0.01;

const COLOR_STOPS = [0xfff3b0, 0xffb347, 0xff7a18, 0xd9480f] as const;

type FlameParticle = {
  readonly sprite: Sprite;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  lifetime: number;
  spin: number;
  wobble: number;
  size: number;
};

export type TokenFlameEffectOptions = {
  x?: number;
  y?: number;
  maxRate?: number;
};

export class TokenFlameEffect {
  public readonly container: Container;

  private readonly maxRate: number;
  private readonly particles: FlameParticle[] = [];
  private targetIntensity = 0;
  private intensity = 0;
  private emissionAccumulator = 0;
  private randomState = 0x6d2b79f5;

  constructor(options: TokenFlameEffectOptions = {}) {
    this.maxRate = Math.max(1, options.maxRate ?? DEFAULT_MAX_RATE);
    this.container = new Container();
    this.container.position.set(options.x ?? EMITTER_X, options.y ?? EMITTER_Y);
    this.container.visible = false;
    this.container.eventMode = "none";
    this.container.zIndex = -1;

    log.info("token_flame_created", {
      maxRate: this.maxRate,
      x: this.container.x,
      y: this.container.y,
    });
  }

  setRate(rate: number): void {
    const safeRate = Number.isFinite(rate) ? Math.max(0, rate) : 0;
    this.targetIntensity = Math.min(safeRate / this.maxRate, 1);
  }

  update(deltaMs: number): void {
    if (deltaMs <= 0) {
      return;
    }

    const deltaSeconds = deltaMs / 1000;
    const smoothing = 1 - Math.exp(-deltaSeconds * 8);
    this.intensity += (this.targetIntensity - this.intensity) * smoothing;

    this.container.visible = this.intensity > INTENSITY_EPSILON || this.particles.length > 0;

    const emissionRate = lerp(0, 26, this.intensity);
    this.emissionAccumulator += emissionRate * deltaSeconds;

    while (this.emissionAccumulator >= 1 && this.particles.length < MAX_PARTICLES) {
      this.emissionAccumulator -= 1;
      this.spawnParticle();
    }

    for (let index = this.particles.length - 1; index >= 0; index -= 1) {
      const particle = this.particles[index];
      particle.age += deltaSeconds;

      const life = particle.age / particle.lifetime;
      if (life >= 1) {
        particle.sprite.destroy();
        this.particles.splice(index, 1);
        continue;
      }

      particle.x += particle.vx * deltaSeconds;
      particle.y += particle.vy * deltaSeconds;
      particle.vx *= Math.max(0.25, 1 - deltaSeconds * 1.8);
      particle.vy -= 14 * deltaSeconds;

      const wobbleOffset = Math.sin(particle.spin + particle.age * particle.wobble) * 0.6;
      particle.sprite.position.set(particle.x + wobbleOffset, particle.y);

      const width = particle.size * lerp(1, 0.35, life);
      const height = particle.size * lerp(1.6, 0.3, life);
      particle.sprite.width = width;
      particle.sprite.height = height;
      particle.sprite.alpha = lerp(0.9, 0, life);
      particle.sprite.tint = sampleFlameColor(life);
    }
  }

  destroy(): void {
    for (const particle of this.particles) {
      particle.sprite.destroy();
    }

    this.particles.length = 0;
    this.container.destroy({ children: true });

    log.info("token_flame_destroyed");
  }

  private spawnParticle(): void {
    const sprite = new Sprite(Texture.WHITE);
    sprite.anchor.set(0.5, 1);

    const spread = lerp(0.8, 4.2, this.intensity);
    const rise = lerp(18, 42, this.intensity);
    const size = lerp(2.4, 5.2, this.intensity) * (0.75 + this.nextRandom() * 0.5);

    const particle: FlameParticle = {
      sprite,
      x: (this.nextRandom() - 0.5) * spread,
      y: 0,
      vx: (this.nextRandom() - 0.5) * lerp(6, 16, this.intensity),
      vy: -rise * (0.8 + this.nextRandom() * 0.35),
      age: 0,
      lifetime: lerp(0.24, 0.52, this.intensity) * (0.85 + this.nextRandom() * 0.35),
      spin: this.nextRandom() * Math.PI * 2,
      wobble: lerp(6, 12, this.intensity),
      size,
    };

    sprite.position.set(particle.x, particle.y);
    sprite.width = size;
    sprite.height = size * 1.5;
    sprite.alpha = 0.9;
    sprite.tint = COLOR_STOPS[0];

    this.container.addChild(sprite);
    this.particles.push(particle);
  }

  // A tiny seeded PRNG keeps the effect stable and testable enough for v1.
  private nextRandom(): number {
    this.randomState = (this.randomState * 1664525 + 1013904223) >>> 0;
    return this.randomState / 0x100000000;
  }
}

function lerp(start: number, end: number, t: number): number {
  return start + (end - start) * t;
}

function sampleFlameColor(t: number): number {
  if (t <= 0.33) {
    return mixColor(COLOR_STOPS[0], COLOR_STOPS[1], t / 0.33);
  }

  if (t <= 0.66) {
    return mixColor(COLOR_STOPS[1], COLOR_STOPS[2], (t - 0.33) / 0.33);
  }

  return mixColor(COLOR_STOPS[2], COLOR_STOPS[3], (t - 0.66) / 0.34);
}

function mixColor(from: number, to: number, t: number): number {
  const clamped = Math.min(Math.max(t, 0), 1);
  const fromR = (from >> 16) & 0xff;
  const fromG = (from >> 8) & 0xff;
  const fromB = from & 0xff;
  const toR = (to >> 16) & 0xff;
  const toG = (to >> 8) & 0xff;
  const toB = to & 0xff;

  const r = Math.round(lerp(fromR, toR, clamped));
  const g = Math.round(lerp(fromG, toG, clamped));
  const b = Math.round(lerp(fromB, toB, clamped));

  return (r << 16) | (g << 8) | b;
}
