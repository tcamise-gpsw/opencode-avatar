# Changelog

## [0.2.0](https://github.com/tcamise-gpsw/opencode-avatar/compare/v0.1.0...v0.2.0) (2026-04-03)


### Features

* **app:** add close robot action ([787944a](https://github.com/tcamise-gpsw/opencode-avatar/commit/787944a1eeb70b7c84f87002e7be214ff566b292))
* **app:** add frontend structured logger ([5a8d691](https://github.com/tcamise-gpsw/opencode-avatar/commit/5a8d69153bf5c1f8f07ba47f2ed05ed43cb70925))
* **app:** add multi-robot renderer and session manager ([117c3ac](https://github.com/tcamise-gpsw/opencode-avatar/commit/117c3acfaa5278c1998b783727c8764286c6b5c5))
* **app:** add robot maximize mode and context menu ([5584bed](https://github.com/tcamise-gpsw/opencode-avatar/commit/5584bede8ec223187c95007a32090b0da653614d))
* **app:** add token flame particle effect system ([218dc4d](https://github.com/tcamise-gpsw/opencode-avatar/commit/218dc4d323f1cea5d20478edde6afc92ed33c242))
* **app:** implement programmatic pixel-art sprite generation for robot ([f32d270](https://github.com/tcamise-gpsw/opencode-avatar/commit/f32d270fc5cd70bf42950f8efafca00f2860354a))
* **app:** implement Robot sprite controller with state animations ([05e8c79](https://github.com/tcamise-gpsw/opencode-avatar/commit/05e8c798aff7aec35fe8ecada31fdefbdb55588e))
* **app:** implement WebSocket client with exponential backoff reconnection ([90f0c8c](https://github.com/tcamise-gpsw/opencode-avatar/commit/90f0c8c396dcc40a65b75e6a94c3cb6c9434aaa6))
* **app:** scaffold Tauri 2 shell with transparent always-on-top overlay window ([ec0abd2](https://github.com/tcamise-gpsw/opencode-avatar/commit/ec0abd2ccfa9350ddf46dba1ace40a4f59ff98a6))
* **app:** wire frontend entrypoint to renderer and WebSocket client ([3288346](https://github.com/tcamise-gpsw/opencode-avatar/commit/32883466ed143e907a3b9e476c0caf00c9436e49))
* **avatar:** add reverse command channel and overlay controls ([8ce4f0e](https://github.com/tcamise-gpsw/opencode-avatar/commit/8ce4f0e6b610b4906e3a82944f04a710820901d4))
* **plugin:** add structured logger with file output and log levels ([7cabd52](https://github.com/tcamise-gpsw/opencode-avatar/commit/7cabd52b3c5134b4b0bb542c67e369729e0f580e))
* **plugin:** implement state machine with TDD — 7 states, priority, hold timers ([1d5a1fe](https://github.com/tcamise-gpsw/opencode-avatar/commit/1d5a1fec14ab06e3a675dfa54f628768b2f7f134))
* **plugin:** implement token tracker with rolling rate calculation (TDD) ([a139a93](https://github.com/tcamise-gpsw/opencode-avatar/commit/a139a93990c17fbdadad3564777c9e7a5fab7c29))
* **plugin:** implement WebSocket server with sync and broadcast (TDD) ([92c710b](https://github.com/tcamise-gpsw/opencode-avatar/commit/92c710b7e87a17b533c5054c381b6989a9e6a8b6))
* **plugin:** wire hooks to state machine, token tracker, and WebSocket broadcast ([2cff013](https://github.com/tcamise-gpsw/opencode-avatar/commit/2cff0134cdc7b836f93aba4a0d127ddcee97dee5))
* **shared:** define WebSocket protocol types and state machine constants ([389c514](https://github.com/tcamise-gpsw/opencode-avatar/commit/389c514a944be814df27aa391dab218f848fe663))


### Bug Fixes

* **app:** anchor overlay window and renderer to bottom-right ([0ef3149](https://github.com/tcamise-gpsw/opencode-avatar/commit/0ef3149beb70bd92c5d32f715ff9e084875c4c93))
* **app:** discard delayed flame emission backlog ([99560f3](https://github.com/tcamise-gpsw/opencode-avatar/commit/99560f3c9b1546fc4866856212c56395e6b211d2))
* **app:** harden frontend logger serialization and fields ([b30df34](https://github.com/tcamise-gpsw/opencode-avatar/commit/b30df34a3fe7bea9108d61a6695ecc94efebce8f))
* **app:** harden renderer init and teardown lifecycle ([14fadc5](https://github.com/tcamise-gpsw/opencode-avatar/commit/14fadc5d6c6880af81509fe157e4b1301a8eff70))
* **app:** ignore stale websocket events during reconnects ([276b765](https://github.com/tcamise-gpsw/opencode-avatar/commit/276b7653213a6bad24386ada116670b149f76bfd))
* **app:** improve tooltip and prompt positioning behavior ([27e4e0e](https://github.com/tcamise-gpsw/opencode-avatar/commit/27e4e0ec36757c034b8cc28bcde1607283b36ada))
* **app:** make idle avatar static ([1987d46](https://github.com/tcamise-gpsw/opencode-avatar/commit/1987d46fe25c4fba741c3a0472a12d98631c8fac))
* **app:** preserve cleanup after bfcache pagehide ([45ce114](https://github.com/tcamise-gpsw/opencode-avatar/commit/45ce1140b7aaff067678e71c14b3e57073f069a2))
* **app:** prevent blurry robot sprites ([396939e](https://github.com/tcamise-gpsw/opencode-avatar/commit/396939e049fd66b2e6ce2e935f72527c60b6eefd))
* **app:** reduce overlay window precedence and restore CSP ([d509e2d](https://github.com/tcamise-gpsw/opencode-avatar/commit/d509e2d77b0f606d3ecc7678521aaccb397f8cd7))
* **app:** refine tooltip and prompt overlay behavior ([f16ed7d](https://github.com/tcamise-gpsw/opencode-avatar/commit/f16ed7dd820509a1c950de0ea2efbe5e8240bfcd))
* **app:** restore macOS dock quit behavior ([399a78a](https://github.com/tcamise-gpsw/opencode-avatar/commit/399a78a7ad16c727e9344432c4589fb0bb6c9cee))
* **app:** tighten robot tooltip spacing ([4ab4d85](https://github.com/tcamise-gpsw/opencode-avatar/commit/4ab4d85b90598cdb7bb66b331dfd2b90ff1a31fa))
* **packaging:** resolve shared protocol at runtime ([3c1b306](https://github.com/tcamise-gpsw/opencode-avatar/commit/3c1b3065e45422e2dacc1b78486803a7f69a3a1b))
* **plugin:** clear stale tool state after interrupts ([d5b735b](https://github.com/tcamise-gpsw/opencode-avatar/commit/d5b735b668460cf7b294054a2692d1ee5cf48661))
* **plugin:** export plugin id for OpenCode loader ([d20c048](https://github.com/tcamise-gpsw/opencode-avatar/commit/d20c0485aeb367617bad1c10ec8d7c501321f912))
* **plugin:** group subagent sessions under parent avatars ([f6127fd](https://github.com/tcamise-gpsw/opencode-avatar/commit/f6127fd935acb14cf87fc3ef8718f3a23e9a3ece))
* **plugin:** harden logger metadata serialization and reserved fields ([4aa17a3](https://github.com/tcamise-gpsw/opencode-avatar/commit/4aa17a3431ef8aa42a505398bf452b9589d28c7e))
* **plugin:** harden token updates and session refresh broadcast ([c4d772c](https://github.com/tcamise-gpsw/opencode-avatar/commit/c4d772cd98a450d3a6c6fee968f2f9740852494a))
* **plugin:** harden websocket server lifecycle races ([22cce83](https://github.com/tcamise-gpsw/opencode-avatar/commit/22cce83a72eb6eee629806b1c208662e4056b40c))
* **plugin:** make token snapshots respect observation time ([025a77e](https://github.com/tcamise-gpsw/opencode-avatar/commit/025a77e176fb9f6d23a81d1be5883f20aff36f3f))
* **plugin:** merge sessions across plugin instances ([5dae715](https://github.com/tcamise-gpsw/opencode-avatar/commit/5dae71553d4f891196efbe58d9900e6b3e4729a7))
* **plugin:** normalize tool states and improve diagnostics ([2959a36](https://github.com/tcamise-gpsw/opencode-avatar/commit/2959a3659773374983eb8ab0182e6f5f9ed71b4e))
* **plugin:** preserve held priority state and latest tool labels ([cce83df](https://github.com/tcamise-gpsw/opencode-avatar/commit/cce83dfdac43d6a2c1aac80b87ba8127f335b0c9))
* **ui:** add robot hover tooltips and silence plugin stderr logs ([9667aa5](https://github.com/tcamise-gpsw/opencode-avatar/commit/9667aa5b0ba73a3ea919ba9e12262a018234a1cf))
