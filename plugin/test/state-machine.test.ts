import { beforeEach, describe, expect, it } from "vitest";
import { SessionStateMachine } from "../src/state-machine.js";

describe("SessionStateMachine", () => {
  let sm: SessionStateMachine;

  beforeEach(() => {
    sm = new SessionStateMachine("test-session");
  });

  describe("initial state", () => {
    it("starts in idle state", () => {
      expect(sm.getState()).toBe("idle");
    });

    it("has no active label", () => {
      expect(sm.getLabel()).toBeNull();
    });
  });

  describe("tool events", () => {
    it("transitions to reading on Read tool start", () => {
      sm.onToolStart("Read", { path: "main.ts" });
      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Reading main.ts");
    });

    it("transitions to editing on Edit tool start", () => {
      sm.onToolStart("Edit", { filePath: "main.ts" });
      expect(sm.getState()).toBe("editing");
      expect(sm.getLabel()).toBe("Editing main.ts");
    });

    it("transitions to editing on Write tool start", () => {
      sm.onToolStart("Write", { filePath: "config.json" });
      expect(sm.getState()).toBe("editing");
      expect(sm.getLabel()).toBe("Writing config.json");
    });

    it("transitions to running on Bash tool start", () => {
      sm.onToolStart("Bash", { command: "npm test" });
      expect(sm.getState()).toBe("running");
      expect(sm.getLabel()).toBe("Running npm test");
    });

    it("transitions to reading on Grep tool start", () => {
      sm.onToolStart("Grep", { pattern: "TODO" });
      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Searching TODO");
    });

    it("transitions to reading on Glob tool start", () => {
      sm.onToolStart("Glob", { pattern: "**/*.ts" });
      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Finding **/*.ts");
    });

    it("uses default state for unknown tools", () => {
      sm.onToolStart("SomeNewTool", {});
      expect(sm.getState()).toBe("running");
    });
  });

  describe("tool completion", () => {
    it("returns to idle after tool ends and hold time elapses", () => {
      sm.onToolStart("Read", { path: "file.ts" });
      expect(sm.getState()).toBe("reading");
      sm.onToolEnd("Read");
      sm.tick(600);
      expect(sm.getState()).toBe("idle");
    });

    it("holds state during hold period after tool ends", () => {
      sm.onToolStart("Read", { path: "file.ts" });
      sm.onToolEnd("Read");
      sm.tick(300);
      expect(sm.getState()).toBe("reading");
    });

    it("keeps the held higher-priority state during rapid lower-priority handoff", () => {
      sm.onToolStart("Bash", { command: "npm test" });
      sm.onToolEnd("Bash");

      sm.onToolStart("Edit", { filePath: "file.ts" });

      expect(sm.getState()).toBe("running");
      expect(sm.getLabel()).toBe("Running npm test");

      sm.tick(600);

      expect(sm.getState()).toBe("editing");
      expect(sm.getLabel()).toBe("Editing file.ts");
    });
  });

  describe("thinking state", () => {
    it("transitions to thinking on message delta", () => {
      sm.onMessageDelta();
      expect(sm.getState()).toBe("thinking");
    });
  });

  describe("waiting state", () => {
    it("transitions to waiting on permission asked", () => {
      sm.onPermissionAsked("Run bash command?");
      expect(sm.getState()).toBe("waiting");
      expect(sm.getLabel()).toBe("Run bash command?");
    });

    it("exits waiting on permission replied", () => {
      sm.onPermissionAsked("Run bash?");
      expect(sm.getState()).toBe("waiting");
      sm.onPermissionReplied();
      expect(sm.getState()).toBe("idle");
    });
  });

  describe("error state", () => {
    it("transitions to error on session error", () => {
      sm.onError("Something broke");
      expect(sm.getState()).toBe("error");
      expect(sm.getLabel()).toBe("Something broke");
    });

    it("clears error after timeout", () => {
      sm.onError("fail");
      sm.tick(5100);
      expect(sm.getState()).toBe("idle");
    });
  });

  describe("state priority", () => {
    it("waiting overrides running", () => {
      sm.onToolStart("Bash", { command: "test" });
      expect(sm.getState()).toBe("running");
      sm.onPermissionAsked("Allow?");
      expect(sm.getState()).toBe("waiting");
    });

    it("error overrides everything", () => {
      sm.onToolStart("Bash", { command: "test" });
      sm.onPermissionAsked("Allow?");
      sm.onError("crash");
      expect(sm.getState()).toBe("error");
    });

    it("running overrides editing", () => {
      sm.onToolStart("Edit", { filePath: "f.ts" });
      sm.onToolStart("Bash", { command: "test" });
      expect(sm.getState()).toBe("running");
    });

    it("uses the most recent equal-priority tool label", () => {
      sm.onToolStart("Read", { path: "foo.ts" });
      sm.onToolStart("Read", { path: "bar.ts" });

      expect(sm.getState()).toBe("reading");
      expect(sm.getLabel()).toBe("Reading bar.ts");
    });
  });

  describe("snapshot", () => {
    it("returns full session info", () => {
      sm.onToolStart("Read", { path: "file.ts" });
      const snap = sm.snapshot();
      expect(snap).toEqual({
        sessionId: "test-session",
        name: "",
        state: "reading",
        label: "Reading file.ts",
        tokens: { total: 0, rate: 0 },
        lastResponse: null,
        pendingPermission: null,
      });
    });
  });
});
