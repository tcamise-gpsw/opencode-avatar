import type { AvatarState } from "@opencode-avatar/shared";

/** Sprite animation config per state */
export interface StateAnimationConfig {
  bodyAnim: string;
  headAnim: string;
  faceFrame: string;
  /** Animation FPS */
  fps: number;
}

/** Full animation config map */
export const STATE_ANIMATIONS: Record<AvatarState, StateAnimationConfig> = {
  idle: { bodyAnim: "breathe", headAnim: "neutral", faceFrame: "sleeping", fps: 6 },
  thinking: { bodyAnim: "breathe", headAnim: "tilt", faceFrame: "dots", fps: 8 },
  reading: { bodyAnim: "lean", headAnim: "neutral", faceFrame: "scan", fps: 8 },
  editing: { bodyAnim: "typing", headAnim: "neutral", faceFrame: "focused", fps: 8 },
  running: { bodyAnim: "vibrate", headAnim: "neutral", faceFrame: "excited", fps: 10 },
  waiting: { bodyAnim: "tap", headAnim: "neutral", faceFrame: "question", fps: 6 },
  error: { bodyAnim: "slump", headAnim: "neutral", faceFrame: "x-eyes", fps: 4 },
};

/** Layout constants */
export const LAYOUT = {
  /** Robot sprite render size in CSS pixels */
  robotSize: 64,
  /** Margin from screen edge */
  edgeMargin: 20,
  /** Gap between stacked robots */
  robotGap: 8,
} as const;
