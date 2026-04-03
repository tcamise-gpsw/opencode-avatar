import { STATE_PRIORITY, type SessionInfo } from "@opencode-avatar/shared";
import { SessionStateMachine } from "./state-machine.js";
import { TokenTracker } from "./token-tracker.js";

export interface SessionMemberRuntime {
  readonly sessionId: string;
  readonly sm: SessionStateMachine;
  readonly tokens: TokenTracker;
  readonly assistantMessageTotals: Map<string, number>;
  lastResponse: string | null;
  pendingPermission: {
    permissionId: string;
    title: string;
  } | null;
}

type SessionMeta = {
  sessionId: string;
  parentId?: string;
  name: string;
  groupId: string;
  member: SessionMemberRuntime;
};

type SessionGroup = {
  groupId: string;
  name: string;
  members: Map<string, SessionMemberRuntime>;
};

export type EnsureSessionResult = {
  groupId: string;
  groupCreated: boolean;
  memberCreated: boolean;
  member: SessionMemberRuntime;
  removedGroup?: {
    groupId: string;
    name: string;
  };
};

export type RemoveSessionResult = {
  groupId: string;
  groupRemoved: boolean;
  name: string;
};

export type RemoveGroupResult = {
  groupId: string;
  name: string;
  sessionIds: string[];
};

export class SessionRegistry {
  private readonly sessions = new Map<string, SessionMeta>();
  private readonly groups = new Map<string, SessionGroup>();

  ensureSession(
    sessionId: string,
    options: {
      name?: string;
      parentId?: string;
    } = {},
  ): EnsureSessionResult {
    let meta = this.sessions.get(sessionId);
    let memberCreated = false;

    if (!meta) {
      meta = {
        sessionId,
        name: "",
        groupId: sessionId,
        member: {
          sessionId,
          sm: new SessionStateMachine(sessionId),
          tokens: new TokenTracker(),
          assistantMessageTotals: new Map(),
          lastResponse: null,
          pendingPermission: null,
        },
      };
      this.sessions.set(sessionId, meta);
      memberCreated = true;
    }

    if (options.parentId !== undefined) {
      meta.parentId = options.parentId || undefined;
    }

    if (options.name !== undefined) {
      meta.name = options.name;
      meta.member.sm.setName(options.name);
    }

    const nextGroupId = this.resolveGroupId(sessionId, meta.parentId, meta.groupId);
    let removedGroup: EnsureSessionResult["removedGroup"];
    let groupCreated = false;

    if (meta.groupId !== nextGroupId || !this.groups.has(meta.groupId)) {
      removedGroup = this.detachFromCurrentGroup(meta);
      const ensuredGroup = this.ensureGroup(nextGroupId);
      ensuredGroup.group.members.set(sessionId, meta.member);
      meta.groupId = nextGroupId;
      groupCreated = ensuredGroup.created;
    }

    this.updateGroupName(meta.groupId);

    return {
      groupId: meta.groupId,
      groupCreated,
      memberCreated,
      member: meta.member,
      removedGroup,
    };
  }

  removeSession(sessionId: string): RemoveSessionResult | null {
    const meta = this.sessions.get(sessionId);
    if (!meta) {
      return null;
    }

    this.sessions.delete(sessionId);
    const groupId = meta.groupId;
    const group = this.groups.get(groupId);
    if (!group) {
      return {
        groupId,
        groupRemoved: true,
        name: meta.name,
      };
    }

    group.members.delete(sessionId);
    if (group.members.size === 0) {
      this.groups.delete(groupId);
      return {
        groupId,
        groupRemoved: true,
        name: group.name,
      };
    }

    this.updateGroupName(groupId);
    return {
      groupId,
      groupRemoved: false,
      name: this.groups.get(groupId)?.name ?? "",
    };
  }

  removeGroup(groupId: string): RemoveGroupResult | null {
    const group = this.groups.get(groupId);
    if (!group) {
      return null;
    }

    const sessionIds = Array.from(group.members.keys());
    for (const sessionId of sessionIds) {
      this.sessions.delete(sessionId);
    }

    this.groups.delete(groupId);
    return {
      groupId,
      name: group.name,
      sessionIds,
    };
  }

  getSession(sessionId: string): SessionMemberRuntime | null {
    return this.sessions.get(sessionId)?.member ?? null;
  }

  getGroupIdForSession(sessionId: string): string | null {
    return this.sessions.get(sessionId)?.groupId ?? (this.groups.has(sessionId) ? sessionId : null);
  }

  getSnapshotBySessionId(sessionId: string, now: number): SessionInfo | null {
    const groupId = this.getGroupIdForSession(sessionId);
    if (!groupId) {
      return null;
    }

    return this.getSnapshotByGroupId(groupId, now);
  }

  getSnapshotByGroupId(groupId: string, now: number): SessionInfo | null {
    const group = this.groups.get(groupId);
    if (!group || group.members.size === 0) {
      return null;
    }

    let primary: SessionInfo | null = null;
    let primaryMember: SessionMemberRuntime | null = null;
    let totalTokens = 0;
    let totalRate = 0;

    for (const member of group.members.values()) {
      member.sm.advanceTime(now);
      member.sm.setTokens(member.tokens.getData(now));
      const snapshot = member.sm.snapshot();

      totalTokens += snapshot.tokens.total;
      totalRate += snapshot.tokens.rate;

      if (!primary || STATE_PRIORITY[snapshot.state] <= STATE_PRIORITY[primary.state]) {
        primary = snapshot;
        primaryMember = member;
      }
    }

    if (!primary) {
      return null;
    }

    return {
      sessionId: groupId,
      name: group.name,
      state: primary.state,
      label: primary.label,
      tokens: {
        total: totalTokens,
        rate: totalRate,
      },
      lastResponse: primaryMember?.lastResponse ?? null,
      pendingPermission: primaryMember?.pendingPermission ?? null,
    };
  }

  getSnapshots(now: number): SessionInfo[] {
    return Array.from(this.groups.keys(), (groupId) => this.getSnapshotByGroupId(groupId, now)).filter(
      (snapshot): snapshot is SessionInfo => snapshot !== null,
    );
  }

  private resolveGroupId(sessionId: string, parentId?: string, previousGroupId?: string): string {
    if (!parentId) {
      return sessionId;
    }

    const parent = this.sessions.get(parentId);
    if (parent) {
      return parent.groupId;
    }

    return previousGroupId ?? parentId;
  }

  private ensureGroup(groupId: string): {
    group: SessionGroup;
    created: boolean;
  } {
    const existing = this.groups.get(groupId);
    if (existing) {
      return { group: existing, created: false };
    }

    const group: SessionGroup = {
      groupId,
      name: "",
      members: new Map(),
    };
    this.groups.set(groupId, group);
    return { group, created: true };
  }

  private detachFromCurrentGroup(meta: SessionMeta): EnsureSessionResult["removedGroup"] {
    const group = this.groups.get(meta.groupId);
    if (!group) {
      return undefined;
    }

    group.members.delete(meta.sessionId);
    if (group.members.size === 0) {
      this.groups.delete(meta.groupId);
      return {
        groupId: meta.groupId,
        name: group.name,
      };
    }

    this.updateGroupName(meta.groupId);
    return undefined;
  }

  private updateGroupName(groupId: string): void {
    const group = this.groups.get(groupId);
    if (!group) {
      return;
    }

    const canonicalName = this.sessions.get(groupId)?.name.trim();
    if (canonicalName) {
      group.name = canonicalName;
      return;
    }

    for (const meta of this.sessions.values()) {
      if (meta.groupId !== groupId) {
        continue;
      }

      const candidate = meta.name.trim();
      if (candidate) {
        group.name = candidate;
        return;
      }
    }

    group.name = "";
  }
}
