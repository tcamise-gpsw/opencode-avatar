import { describe, expect, it } from "vitest";

import { SessionRegistry } from "../src/session-registry.js";

describe("SessionRegistry", () => {
  it("collapses a child session into its parent group", () => {
    const registry = new SessionRegistry();

    registry.ensureSession("parent", { name: "Parent Task" });
    const child = registry.ensureSession("child", {
      name: "Child Task",
      parentId: "parent",
    });

    expect(child.groupId).toBe("parent");

    const snapshots = registry.getSnapshots(0);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]?.sessionId).toBe("parent");
    expect(snapshots[0]?.name).toBe("Parent Task");
  });

  it("removes child token burn when the child session ends", () => {
    const registry = new SessionRegistry();

    const parent = registry.ensureSession("parent", { name: "Parent Task" });
    const child = registry.ensureSession("child", {
      name: "Child Task",
      parentId: "parent",
    });

    parent.member.tokens.add(100, 0);
    child.member.tokens.add(250, 0);

    expect(registry.getSnapshotByGroupId("parent", 0)?.tokens.total).toBe(350);

    registry.removeSession("child");

    const snapshot = registry.getSnapshotByGroupId("parent", 6000);
    expect(snapshot?.tokens.total).toBe(100);
    expect(snapshot?.tokens.rate).toBe(0);
  });

  it("removes the whole group when the root session ends", () => {
    const registry = new SessionRegistry();

    registry.ensureSession("parent", { name: "Parent Task" });
    registry.ensureSession("child", {
      name: "Child Task",
      parentId: "parent",
    });

    const result = registry.removeSession("parent");

    expect(result).toEqual({
      groupId: "parent",
      groupRemoved: false,
      name: "Child Task",
    });
    expect(registry.getSnapshotByGroupId("parent", 0)?.name).toBe("Child Task");
  });
});
