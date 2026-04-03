# "Awaiting Input" State — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the avatar visually distinguish "AI is idle/sleeping" from "AI finished responding and is waiting for the user's next input" — the single biggest UX gap in the current avatar.

**Architecture:** Add a new `"awaiting"` avatar state that sits between `"thinking"` and `"idle"` in the priority chain. The state machine tracks whether the AI has completed at least one assistant message; if so, transitioning to idle instead shows `"awaiting"` (eyes open, breathing). Also map the `question` tool to `"waiting"` state since it blocks on human input. All changes flow through existing protocol — no new message types needed.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo (shared → plugin → app dependency chain)

**Spec:** This plan is self-contained; design rationale is in the task descriptions.

**Build/test commands:**
- Build shared: `corepack pnpm --filter @opencode-avatar/shared build`
- Build plugin: `corepack pnpm --filter @opencode-avatar/plugin build`
- Test plugin: `corepack pnpm --filter @opencode-avatar/plugin test`
- Type-check all: build each package in order (shared → plugin → app)

**Important:** After any `shared/` change, rebuild shared before building/testing plugin or app.

---

## File Map

### Modified files
| File | Changes |
|------|---------|
| `shared/src/protocol.ts` | Add `"awaiting"` to `AVATAR_STATES` array and `STATE_PRIORITY` map; add `question: "waiting"` to `TOOL_STATE_MAP`; bump `idle` priority from 6→7 |
| `plugin/src/state-machine.ts` | Add `hasCompletedMessage` flag; return `"awaiting"` when idle after AI response; add `"question"` case to `makeToolLabel` |
| `plugin/test/state-machine.test.ts` | Add tests for `"awaiting"` state transitions and `"question"` tool mapping |
| `app/src/types.ts` | Add `awaiting` entry to `STATE_ANIMATIONS` |

No new files needed.

---

## Task 1: Extend shared protocol with `"awaiting"` state

**Files:**
- Modify: `shared/src/protocol.ts`

The `"awaiting"` state indicates the AI has finished responding and the user should type next. It sits between `"thinking"` (priority 5) and `"idle"` (priority 7) at priority 6.

- [ ] **Step 1:** In `shared/src/protocol.ts`, add `"awaiting"` to the `AVATAR_STATES` array between `"thinking"` and `"idle"`:

```typescript
export const AVATAR_STATES = [
  "error",
  "waiting",
  "running",
  "editing",
  "reading",
  "thinking",
  "awaiting",
  "idle",
] as const;
```

- [ ] **Step 2:** Update `STATE_PRIORITY` to include `awaiting: 6` and bump `idle` to `7`:

```typescript
export const STATE_PRIORITY: Record<AvatarState, number> = {
  error: 0,
  waiting: 1,
  running: 2,
  editing: 3,
  reading: 4,
  thinking: 5,
  awaiting: 6,
  idle: 7,
};
```

- [ ] **Step 3:** Add `question: "waiting"` to `TOOL_STATE_MAP`:

```typescript
export const TOOL_STATE_MAP: Record<string, AvatarState> = {
  // Reading tools
  Read: "reading",
  Grep: "reading",
  Glob: "reading",
  // Editing tools
  Edit: "editing",
  Write: "editing",
  // Running tools
  Bash: "running",
  // Browser tools (reading)
  playwright_browser_snapshot: "reading",
  playwright_browser_take_screenshot: "reading",
  playwright_browser_navigate: "running",
  playwright_browser_click: "running",
  // Task/subagent tools
  Task: "thinking",
  // Human-input-blocking tools
  question: "waiting",
};
```

- [ ] **Step 4:** Build shared package:

Run: `corepack pnpm --filter @opencode-avatar/shared build`
Expected: Clean build, no errors.

- [ ] **Step 5:** Commit: `feat(shared): add "awaiting" avatar state and map question tool to waiting`

---

## Task 2: Update state machine to emit `"awaiting"` state

**Files:**
- Modify: `plugin/src/state-machine.ts`

The state machine tracks a `hasCompletedMessage` boolean. When `onMessageComplete()` is called (AI finished a response), it sets this flag. The `getState()` method returns `"awaiting"` instead of `"idle"` when the flag is set.

- [ ] **Step 1:** Add the `hasCompletedMessage` private field, initialized to `false`:

In `plugin/src/state-machine.ts`, add after the existing `private tokenData` field:

```typescript
private hasCompletedMessage = false;
```

- [ ] **Step 2:** Set the flag in `onMessageComplete()`:

Update `onMessageComplete` to:

```typescript
onMessageComplete(): void {
  this.isThinking = false;
  this.hasCompletedMessage = true;
}
```

- [ ] **Step 3:** Update `getState()` to return `"awaiting"` when appropriate:

Change the end of `getState()` from:

```typescript
    if (this.isThinking) {
      return "thinking";
    }

    return "idle";
```

to:

```typescript
    if (this.isThinking) {
      return "thinking";
    }

    if (this.hasCompletedMessage) {
      return "awaiting";
    }

    return "idle";
```

- [ ] **Step 4:** Add a `"question"` case to `makeToolLabel`:

In the `makeToolLabel` method's switch statement, add before the `default` case:

```typescript
      case "question":
        return "Waiting for your answer";
```

- [ ] **Step 5:** Build plugin to verify compilation:

Run: `corepack pnpm --filter @opencode-avatar/plugin build`
Expected: Clean build, no errors.

- [ ] **Step 6:** Commit: `feat(plugin): track completed messages for awaiting state and label question tool`

---

## Task 3: Add tests for new state machine behavior

**Files:**
- Modify: `plugin/test/state-machine.test.ts`

- [ ] **Step 1:** Add tests for the `"awaiting"` state in a new `describe("awaiting state")` block. Insert after the existing `describe("error state")` block:

```typescript
  describe("awaiting state", () => {
    it("stays idle before any message completes", () => {
      expect(sm.getState()).toBe("idle");
    });

    it("transitions to awaiting after a message completes", () => {
      sm.onMessageDelta();
      sm.onMessageComplete();
      expect(sm.getState()).toBe("awaiting");
    });

    it("transitions from awaiting to thinking on new message", () => {
      sm.onMessageDelta();
      sm.onMessageComplete();
      expect(sm.getState()).toBe("awaiting");
      sm.onMessageDelta();
      expect(sm.getState()).toBe("thinking");
    });

    it("returns to awaiting after thinking completes", () => {
      sm.onMessageDelta();
      sm.onMessageComplete();
      sm.onMessageDelta();
      sm.onMessageComplete();
      expect(sm.getState()).toBe("awaiting");
    });

    it("tools override awaiting state", () => {
      sm.onMessageDelta();
      sm.onMessageComplete();
      expect(sm.getState()).toBe("awaiting");
      sm.onToolStart("Read", { path: "file.ts" });
      expect(sm.getState()).toBe("reading");
    });

    it("returns to awaiting after tool completes and hold expires", () => {
      sm.onMessageDelta();
      sm.onMessageComplete();
      sm.onToolStart("Read", { path: "file.ts" });
      sm.onToolEnd("Read");
      sm.tick(600);
      expect(sm.getState()).toBe("awaiting");
    });
  });
```

- [ ] **Step 2:** Add a test for the `question` tool mapping in the `describe("tool events")` block:

```typescript
    it("transitions to waiting on question tool start", () => {
      sm.onToolStart("question", {});
      expect(sm.getState()).toBe("waiting");
      expect(sm.getLabel()).toBe("Waiting for your answer");
    });
```

- [ ] **Step 3:** Update the snapshot test to reflect the fact that after `onMessageComplete`, state is `"awaiting"` not `"idle"`. The existing snapshot test creates a fresh state machine and calls `onToolStart` without `onMessageComplete`, so it should still work. Verify:

Run: `corepack pnpm --filter @opencode-avatar/plugin test`
Expected: All tests pass, including the new ones.

**Important:** The existing test `"exits waiting on permission replied"` asserts `idle` after permission reply. If the test calls `onMessageComplete` before permission, this might break. Check: the existing test only calls `onPermissionAsked` then `onPermissionReplied` — no `onMessageComplete` — so `hasCompletedMessage` is `false` and the state correctly returns to `"idle"`. No existing test should break.

- [ ] **Step 4:** Commit: `test(plugin): add awaiting state and question tool tests`

---

## Task 4: Add `awaiting` animation config in app

**Files:**
- Modify: `app/src/types.ts`

- [ ] **Step 1:** Add `awaiting` entry to `STATE_ANIMATIONS`. Use `breathe` body animation (same as idle) with `face-neutral` (eyes open, small mouth — already generated in `sprites.ts`). This gives a calm, awake look that clearly differs from the sleeping face of `idle`:

```typescript
export const STATE_ANIMATIONS: Record<AvatarState, StateAnimationConfig> = {
  idle: { bodyAnim: "breathe", headAnim: "neutral", faceFrame: "sleeping", fps: 6 },
  thinking: { bodyAnim: "breathe", headAnim: "tilt", faceFrame: "dots", fps: 8 },
  reading: { bodyAnim: "lean", headAnim: "neutral", faceFrame: "scan", fps: 8 },
  editing: { bodyAnim: "typing", headAnim: "neutral", faceFrame: "focused", fps: 8 },
  running: { bodyAnim: "vibrate", headAnim: "neutral", faceFrame: "excited", fps: 10 },
  waiting: { bodyAnim: "tap", headAnim: "neutral", faceFrame: "question", fps: 6 },
  error: { bodyAnim: "slump", headAnim: "neutral", faceFrame: "x-eyes", fps: 4 },
  awaiting: { bodyAnim: "breathe", headAnim: "neutral", faceFrame: "neutral", fps: 6 },
};
```

- [ ] **Step 2:** Build the app to verify types align:

Run: `corepack pnpm --filter @opencode-avatar/app build`
Expected: Clean build. The `Record<AvatarState, ...>` type will enforce that all states are covered — if `awaiting` is missing, it won't compile.

- [ ] **Step 3:** Commit: `feat(app): add awaiting state animation with neutral face`

---

## Task 5: Manual verification and final commit

- [ ] **Step 1:** Build entire project in order:

```bash
corepack pnpm --filter @opencode-avatar/shared build && \
corepack pnpm --filter @opencode-avatar/plugin build && \
corepack pnpm --filter @opencode-avatar/app build
```

Expected: All packages build cleanly.

- [ ] **Step 2:** Run all plugin tests:

Run: `corepack pnpm --filter @opencode-avatar/plugin test`
Expected: All tests pass.

- [ ] **Step 3:** Manual smoke test (if Tauri app can be launched):

1. Start the app with a live OpenCode session
2. Observe the avatar starts in `idle` (sleeping face) for a new session
3. Send a message — avatar transitions through `thinking` → tool states → `thinking`
4. After AI responds, avatar shows `awaiting` (breathing, neutral/open eyes) — NOT sleeping
5. Type a new message — avatar goes to `thinking`
6. If a `question` tool fires, avatar shows `waiting` (tapping, question face) with label "Waiting for your answer"

- [ ] **Step 4:** If all checks pass, no additional commit needed. If fixes were required, commit them.

---

## Summary of Visual States After Implementation

| State | Body Animation | Face | When |
|-------|---------------|------|------|
| `idle` | Breathing | 😴 Sleeping (zzz) | Brand new session, no AI response yet |
| `awaiting` | Breathing | 😐 Neutral (eyes open) | AI finished responding, waiting for user |
| `thinking` | Breathing | ⋯ Dots | AI is generating a response |
| `reading` | Leaning | 🔍 Scanning | Reading/searching files |
| `editing` | Typing | 😤 Focused | Writing/editing files |
| `running` | Vibrating | 😃 Excited | Running commands |
| `waiting` | Tapping | ❓ Question | Permission request OR question tool |
| `error` | Slumping | ✖ X-eyes | Session error (5s timeout) |
