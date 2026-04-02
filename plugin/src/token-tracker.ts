import type { TokenData } from "@opencode-avatar/shared/src/protocol.js";
import { createLogger } from "./logger.js";

const log = createLogger("token-tracker");

const WINDOW_MS = 5000;

interface Sample {
  tokens: number;
  timestamp: number;
}

export class TokenTracker {
  private total = 0;
  private samples: Sample[] = [];
  private lastTimestamp = 0;

  add(tokens: number, timestamp: number): void {
    this.total += tokens;
    this.samples.push({ tokens, timestamp });
    this.lastTimestamp = timestamp;

    log.debug("token_sample", { tokens, total: this.total, timestamp });
  }

  getRateAt(now: number): number {
    const windowStart = now - WINDOW_MS;

    this.samples = this.samples.filter((sample) => sample.timestamp >= windowStart);

    const sum = this.samples.reduce((total, sample) => total + sample.tokens, 0);
    return Math.round(sum / (WINDOW_MS / 1000));
  }

  getData(): TokenData {
    return {
      total: this.total,
      rate: this.getRateAt(this.lastTimestamp),
    };
  }

  reset(): void {
    this.total = 0;
    this.samples = [];
    this.lastTimestamp = 0;
  }
}
