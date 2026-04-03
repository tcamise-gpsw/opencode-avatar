export class LeadershipRetryController {
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private waitingForLeadership = false;

  constructor(
    private readonly retryMs: number,
    private readonly attemptLeadership: () => void,
  ) {}

  isWaitingForLeadership(): boolean {
    return this.waitingForLeadership;
  }

  waitForLeadership(): boolean {
    const firstWait = !this.waitingForLeadership;
    this.waitingForLeadership = true;

    if (!this.retryTimer) {
      this.retryTimer = setTimeout(() => {
        this.retryTimer = null;
        this.attemptLeadership();
      }, this.retryMs);
    }

    return firstWait;
  }

  acquireLeadership(): boolean {
    const recoveredLeadership = this.waitingForLeadership;
    this.waitingForLeadership = false;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }

    return recoveredLeadership;
  }

  dispose(): void {
    this.waitingForLeadership = false;

    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

export function isAddressInUseError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "EADDRINUSE"
  );
}
