# OpenCode Avatar — Design Spec

**Date:** 2026-04-02
**Status:** Draft
**Author:** sp-plan + user collaboration

## Overview

A native macOS desktop overlay that displays pixel-art robot avatars representing active OpenCode agents. Each robot's face and body animate to reflect what its agent is doing — thinking, editing, reading files, running commands, waiting for permission, or erroring. Token burn rate drives a flame particle effect at each robot's base.

The system is ambient — small, unobtrusive, always-on-top. You glance at it to see what your agents are doing. You ignore it when you're focused on something else.

## Goals

- **Ambient awareness** of agent activity without switching windows
- **One robot per active agent** — see all agents at a glance
- **Pixel-art retro style** — 32×32 sprites, limited palette, classic feel
- **Token flames** — visual indicator of burn rate, grows with intensity
- **Reliable and debuggable** — structured logging everywhere, tests on logic-heavy code
- **Well-documented** — architecture and usage docs maintained as we develop

## Non-Goals (v1)

- Draggable positioning (v1.1)
- Hover for latest messages (v1.1)
- Click to respond / continue button (v1.1)
- Live2D upgrade (v2+)
- Cross-platform (Linux/Windows) — macOS only for v1, architecture doesn't preclude it

## System Architecture

Three components connected by WebSocket:

```
┌──────────────┐     hooks     ┌──────────────────┐     WS :2728    ┌─────────────────┐
│   OpenCode   │──────────────▶│     Plugin        │───────────────▶│    Tauri App     │
│              │               │  avatar-bridge.ts │                │                 │
│ Agent sessions│               │  State machine    │                │ PixiJS canvas    │
│ Tool calls   │               │  WS server        │                │ Sprite renderer  │
│ Messages     │               │  Token tracking   │                │ Flame particles  │
│ Token usage  │               │                   │                │ Window mgmt      │
└──────────────┘               └──────────────────┘                └─────────────────┘
                                                                           │
                                                                    renders into
                                                                           │
                                                                    ┌──────▼──────┐
                                                                    │  macOS       │
                                                                    │  Transparent │
                                                                    │  Overlay     │
                                                                    └─────────────┘
```

### Component 1: OpenCode (existing)

Already running. Emits events via its plugin hook system. No modifications needed. Relevant hooks:

- `event` — session status, errors, permission events
- `tool.execute.before` / `tool.execute.after` — tool call lifecycle
- `chat.message` — message deltas (LLM generating)

### Component 2: Plugin — `avatar-bridge.ts` (we build)

An OpenCode plugin that:

1. **Listens** to OpenCode hooks for all session/agent activity
2. **Maps** raw events into avatar states via a state machine
3. **Tracks** token usage per session (cumulative total + rolling rate)
4. **Serves** a WebSocket on port 2728, broadcasting state changes to connected clients

Adapted from the proven `blob-office.ts` plugin from [Session-Character-Visualizer](https://github.com/Caffa/Session-Character-Visualizer). We reuse its state machine patterns and tool-to-status mapping.

### Component 3: Tauri App (we build)

A Tauri 2 application that:

1. **Creates** a transparent, always-on-top, click-through macOS window
2. **Connects** to the plugin's WebSocket
3. **Renders** one pixel-art robot per active session using PixiJS
4. **Animates** each robot based on state changes
5. **Renders** token flame particles at each robot's base

### Why This Split?

The plugin runs inside OpenCode's process and has access to the hook API. The Tauri app is a separate native process that owns the overlay window. WebSocket is the cleanest bridge — it supports multiple simultaneous consumers, naturally handles reconnection, and is already proven by blob-office.

## Agent State Machine

Each robot has one active state. The plugin maps OpenCode events to these states:

| State | Trigger | Face Expression | Body Animation |
|-------|---------|----------------|----------------|
| `idle` | No activity for 5s | Neutral, half-closed eyes | Gentle breathing/bob |
| `thinking` | LLM generating (message deltas) | Dot-dot-dot on screen | Head tilts side-to-side |
| `reading` | `Read`, `Grep`, `Glob` tool calls | Eyes scanning left-right | Slight lean forward |
| `editing` | `Edit`, `Write` tool calls | Focused, one eye squinted | Arms moving (typing) |
| `running` | `Bash` tool calls | Excited face | Body vibrates/shakes |
| `waiting` | `permission.asked` event | Question mark on face | Hand raised, tapping foot |
| `error` | `session.error` or error events | X-eyes or swirly eyes | Slumps, smoke puff |

### State Priority

When multiple events overlap: `error > waiting > running > editing > reading > thinking > idle`

### Transitions

- States don't snap instantly — 2-3 frame blend between expressions
- When a tool call ends, the robot holds that state for 0.5s before falling back (prevents flickering during rapid tool sequences)
- State evaluates what's "most important" happening right now, not just the latest event

### Session Lifecycle

- Robot **appears** with a pop-in/bounce animation when a session starts
- Robot **disappears** with a fade/shrink when session ends or idle for 60s
- Robot **reappears** if activity resumes on a previously-idle session

## Pixel Art & Animation System

### Layered Sprites

The robot is composited from independent layers to avoid combinatorial explosion:

1. **Body** (bottom) — torso, arms, legs. Poses: idle-breathe (4 frames), typing (4 frames), vibrate (2 frames), slump (2 frames)
2. **Head** (middle) — the head shell. Poses: neutral, tilt-left, tilt-right, lean-forward
3. **Face** (top) — screen-face expression. Frames: neutral, dots-thinking, scan-eyes, focused, question-mark, x-eyes, happy, sleeping
4. **Effects** (overlay) — flame particles, smoke puffs, sparkles

### Dimensions

- **Sprite frame:** 32×32 pixels
- **Render size:** 64×64 CSS pixels (2x scale)
- **Physical pixels:** 128×128 on Retina — crisp pixel art at small desktop size

### Animation

- PixiJS `AnimatedSprite` handles frame stepping
- Most animations at 6-8 FPS (classic pixel art timing)
- Each layer animates independently — face can change while body continues its loop
- State transitions trigger layer changes: e.g., entering `editing` state → body switches to typing loop, face switches to focused expression

### Color Palette

Limited 8-color palette per state for cohesive retro feel:

- **Normal states:** Green accent (#4ade80), grey body (#64748b), dark screen (#0f172a)
- **Waiting:** Yellow accent (#facc15)
- **Error:** Red accent (#f87171)
- **Flames:** Orange (#f97316), yellow (#facc15), red (#ef4444)

### Art Pipeline (v1)

Programmatic pixel art generated via canvas — no external image files needed to ship. This lets us iterate on the character without an art pipeline. Real artist-made sprite sheets (PNG) can be swapped in later as drop-in replacements via a config path.

## Token Flame System

### Data Source

The plugin tracks per-session token usage from `AssistantMessage.tokens` and `StepFinishPart.tokens`:

- `tokens.total` — cumulative token count for the session
- `tokens.rate` — tokens per second, rolling 5-second window average

### Flame Rendering

PixiJS particle emitter on the effects layer, positioned at each robot's base:

- **Particles:** Small 2×2 and 4×4 pixel squares in orange/yellow/red
- **Behavior:** Rise upward, slight random horizontal drift, fade out over 0.5-1s
- **Mapping from `tokens.rate`:**
  - 0 tok/s → no flames
  - 1-50 tok/s → small flicker (2-3 particles, max height 8px)
  - 50-200 tok/s → medium flame (5-8 particles, max height 20px)
  - 200+ tok/s → roaring flame (10-15 particles, max height 40px, above robot's head)
- **Ramp:** Smooth transition between intensities over 1s (no abrupt jumps)

## Multi-Avatar Layout

### Positioning

Robots stack vertically in the bottom-right corner of the screen:

- First robot: 20px from right edge, 20px from bottom edge
- Each additional robot: 8px above the previous one
- Stack grows upward

### Ordering

Sorted by session creation time — oldest at bottom, newest at top. New robots pop in at the top with a bounce animation.

### Window Management

- **Single Tauri window** containing the full PixiJS canvas, sized to fit the robot stack
- Canvas height resizes dynamically as robots are added/removed
- **Always on top** — `set_always_on_top(true)`
- **Transparent background** — only robots and flames are visible
- **Click-through** — mouse passes through to windows below (except on robot pixels, for future interactions)
- **All spaces** — visible on every macOS desktop/space
- **No dock icon, no menu bar** — pure overlay

### Reconnection

If WebSocket disconnects (OpenCode restarted):

1. All robots enter a "disconnected" visual state — greyed out, sleeping face
2. Auto-reconnect with exponential backoff (1s, 2s, 4s, 8s, max 30s)
3. On reconnect, receive `sync` message and restore all robot states
4. Robots wake up with a small animation

## WebSocket Protocol

Port 2728. JSON messages.

### Messages: Plugin → App

**State update** (sent on every state change):
```json
{
  "type": "state",
  "sessionId": "abc123",
  "state": "thinking",
  "label": "Reading main.ts",
  "tokens": { "total": 4521, "rate": 120 },
  "timestamp": 1706000000
}
```

**Session lifecycle:**
```json
{
  "type": "session",
  "sessionId": "abc123",
  "action": "created",
  "name": "sp-execute",
  "timestamp": 1706000000
}
```

**Initial sync** (sent on WS connect):
```json
{
  "type": "sync",
  "sessions": [
    { "sessionId": "abc123", "state": "thinking", "label": "...", "name": "sp-execute", "tokens": { "total": 4521, "rate": 120 } }
  ]
}
```

### Messages: App → Plugin (future)

Reserved for v1.1 interactions (send message, grant permission, etc.). Not implemented in v1.

## Cross-Cutting Concerns

### Documentation

- **`README.md`** — setup, build, run instructions. Updated as architecture changes.
- **`docs/architecture.md`** — living version of this design. Component diagram, data flow, protocol spec. Updated when features are added.
- **Inline JSDoc/TSDoc** on all public interfaces — plugin hooks, WebSocket message types, sprite system API.
- Documentation is treated as part of the definition of done for every feature.

### Testing

Unit tests where they provide real value — on the logic-heavy, bug-prone pieces:

- **Plugin state machine** — test every state transition. Given event X in state Y, assert state Z. Edge cases: rapid tool sequences, overlapping events, session cleanup.
- **WebSocket protocol** — test correct messages emitted for event sequences. Mock the OpenCode hooks.
- **Sprite layer mapping** — test that state changes produce correct sprite layer/frame selections. No rendering needed, just mapping logic.
- **Token rate calculation** — test rolling average, edge cases (first message, gaps, bursts).

**NOT unit tested:** PixiJS rendering internals, Tauri window management, visual appearance. These are verified by running the app.

**Test runner:** Vitest for the TypeScript code (plugin + frontend logic).

### Logging

Structured logging throughout both components for easy debugging and iteration:

**Plugin logging:**
- Every OpenCode event received (debug level)
- Every state transition with before/after (info level)
- Every WebSocket connection/disconnection (info level)
- Token rate calculations (debug level)
- Errors with full context (error level)

**Tauri app logging:**
- WebSocket messages received (debug level)
- Sprite transitions (debug level)
- Reconnection attempts (info level)
- Window lifecycle events from Rust side (info level)
- Render errors (error level)

**Configuration:**
- `AVATAR_LOG_LEVEL=debug|info|warn|error` — controls verbosity (default: `info`)
- `AVATAR_DEBUG=1` — enables verbose logging + a small debug overlay in the Tauri window showing current state, token rate, WS connection status

**Log sink:**
- Both components write to `~/.opencode-avatar/logs/` with rotation (5 files, 1MB each)
- Also print to stderr for terminal visibility during development

## Project Structure

```
opencode-avatar/
├── README.md
├── docs/
│   └── architecture.md
├── plugin/                          # OpenCode plugin
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts                 # Plugin entry, hook registration
│   │   ├── state-machine.ts         # State transitions, priority logic
│   │   ├── token-tracker.ts         # Rolling rate calculation
│   │   ├── ws-server.ts             # WebSocket server
│   │   ├── logger.ts                # Structured logging
│   │   └── types.ts                 # Shared types (states, messages)
│   └── test/
│       ├── state-machine.test.ts
│       ├── token-tracker.test.ts
│       └── ws-protocol.test.ts
├── app/                             # Tauri desktop app
│   ├── package.json
│   ├── tsconfig.json
│   ├── src-tauri/                   # Rust backend
│   │   ├── Cargo.toml
│   │   ├── src/
│   │   │   └── main.rs             # Window setup, always-on-top, transparency
│   │   └── tauri.conf.json
│   └── src/                         # Frontend (PixiJS)
│       ├── main.ts                  # Entry, WS connection, app lifecycle
│       ├── renderer.ts              # PixiJS setup, robot management
│       ├── robot.ts                 # Single robot: layers, animation, state
│       ├── flames.ts                # Particle emitter for token flames
│       ├── sprites.ts               # Programmatic sprite generation
│       ├── ws-client.ts             # WebSocket client with reconnection
│       ├── logger.ts                # Frontend structured logging
│       └── types.ts                 # Shared types
└── shared/                          # Shared between plugin and app
    └── protocol.ts                  # WebSocket message type definitions
```

## Technology Stack

| Component | Technology | Version |
|-----------|-----------|---------|
| Plugin runtime | TypeScript, Node.js | TS 5.x |
| Plugin API | `@opencode-ai/plugin` | latest |
| Desktop shell | Tauri | 2.x |
| 2D renderer | PixiJS | 8.x |
| Test runner | Vitest | latest |
| Package manager | pnpm | latest |
| Build tool | Vite | latest |

## Future Work (post-v1)

- **v1.1:** Draggable positioning, hover tooltip showing latest messages, click-to-continue button
- **v1.2:** System tray integration, launch-on-login, preferences panel
- **v2:** Live2D character model upgrade, custom character skins
- **vNext:** Linux/Windows support, voice reactions, integration with other AI coding tools
