import { afterEach, describe, expect, it, vi } from "vitest";

import { LeadershipRetryController } from "../src/leadership-retry.js";

describe("LeadershipRetryController", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("schedules a single retry while waiting for leadership", () => {
    vi.useFakeTimers();
    const attemptLeadership = vi.fn();
    const retry = new LeadershipRetryController(1_000, attemptLeadership);

    expect(retry.waitForLeadership()).toBe(true);
    expect(retry.waitForLeadership()).toBe(false);

    vi.advanceTimersByTime(999);
    expect(attemptLeadership).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(attemptLeadership).toHaveBeenCalledTimes(1);
  });

  it("clears a pending retry when leadership is acquired", () => {
    vi.useFakeTimers();
    const attemptLeadership = vi.fn();
    const retry = new LeadershipRetryController(1_000, attemptLeadership);

    retry.waitForLeadership();

    expect(retry.acquireLeadership()).toBe(true);
    expect(retry.isWaitingForLeadership()).toBe(false);

    vi.runAllTimers();
    expect(attemptLeadership).not.toHaveBeenCalled();
  });

  it("can schedule another retry after a failed leadership attempt", () => {
    vi.useFakeTimers();
    const attemptLeadership = vi.fn();
    const retry = new LeadershipRetryController(1_000, attemptLeadership);

    retry.waitForLeadership();
    vi.advanceTimersByTime(1_000);
    expect(attemptLeadership).toHaveBeenCalledTimes(1);

    expect(retry.waitForLeadership()).toBe(false);
    vi.advanceTimersByTime(1_000);
    expect(attemptLeadership).toHaveBeenCalledTimes(2);
  });

  it("disposes pending retries", () => {
    vi.useFakeTimers();
    const attemptLeadership = vi.fn();
    const retry = new LeadershipRetryController(1_000, attemptLeadership);

    retry.waitForLeadership();
    retry.dispose();

    vi.runAllTimers();
    expect(attemptLeadership).not.toHaveBeenCalled();
    expect(retry.isWaitingForLeadership()).toBe(false);
  });
});
