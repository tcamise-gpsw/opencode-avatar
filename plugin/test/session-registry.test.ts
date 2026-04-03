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

  it("initializes lastResponse and pendingPermission as null", () => {
    const registry = new SessionRegistry();
    const created = registry.ensureSession("s1", { name: "Session 1" });

    expect(created.member.lastResponse).toBeNull();
    expect(created.member.pendingPermission).toBeNull();

    const snapshot = registry.getSnapshotByGroupId("s1", 0);
    expect(snapshot?.lastResponse).toBeNull();
    expect(snapshot?.pendingPermission).toBeNull();
  });

  it("exposes lastResponse and pendingPermission from the primary member snapshot", () => {
    const registry = new SessionRegistry();
    const parent = registry.ensureSession("parent", { name: "Parent Task" });
    const child = registry.ensureSession("child", {
      name: "Child Task",
      parentId: "parent",
    });

    parent.member.sm.onMessageDelta();
    parent.member.lastResponse = "Parent response text";
    parent.member.pendingPermission = {
      permissionId: "perm-parent",
      title: "Allow parent action",
    };

    child.member.sm.onPermissionAsked("Needs permission");
    child.member.lastResponse = "Child response text";
    child.member.pendingPermission = {
      permissionId: "perm-child",
      title: "Allow child action",
    };

    const snapshot = registry.getSnapshotByGroupId("parent", 0);
    expect(snapshot?.state).toBe("waiting");
    expect(snapshot?.lastResponse).toBe("Child response text");
    expect(snapshot?.pendingPermission).toEqual({
      permissionId: "perm-child",
      title: "Allow child action",
    });
  });

  it("includes updated lastResponse and pendingPermission in grouped snapshots", () => {
    const registry = new SessionRegistry();
    const created = registry.ensureSession("group-1", { name: "Group One" });

    created.member.lastResponse = "Tail text";
    created.member.pendingPermission = {
      permissionId: "perm-1",
      title: "Approve file write",
    };

    const snapshot = registry.getSnapshotByGroupId("group-1", 0);
    expect(snapshot?.lastResponse).toBe("Tail text");
    expect(snapshot?.pendingPermission).toEqual({
      permissionId: "perm-1",
      title: "Approve file write",
    });
  });

  it("removes an entire grouped robot snapshot on explicit close", () => {
    const registry = new SessionRegistry();

    registry.ensureSession("parent", { name: "Parent Task" });
    registry.ensureSession("child", {
      name: "Child Task",
      parentId: "parent",
    });

    const removed = registry.removeGroup("parent");

    expect(removed?.groupId).toBe("parent");
    expect(removed?.name).toBe("Parent Task");
    expect(removed?.sessionIds).toEqual(["parent", "child"]);
    expect(registry.getSession("parent")).toBeNull();
    expect(registry.getSession("child")).toBeNull();
    expect(registry.getSnapshotByGroupId("parent", 0)).toBeNull();
  });
});
