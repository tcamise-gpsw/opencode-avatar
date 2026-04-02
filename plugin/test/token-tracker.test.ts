import { beforeEach, describe, expect, it } from "vitest";
import { TokenTracker } from "../src/token-tracker.js";

describe("TokenTracker", () => {
  let tracker: TokenTracker;

  beforeEach(() => {
    tracker = new TokenTracker();
  });

  describe("total tracking", () => {
    it("starts at zero", () => {
      expect(tracker.getData().total).toBe(0);
    });

    it("accumulates token counts", () => {
      tracker.add(100, 1000);
      tracker.add(200, 2000);

      expect(tracker.getData().total).toBe(300);
    });
  });

  describe("rate calculation", () => {
    it("starts at zero rate", () => {
      expect(tracker.getData().rate).toBe(0);
    });

    it("calculates rate over a rolling 5-second window", () => {
      tracker.add(500, 0);

      expect(tracker.getRateAt(2500)).toBe(100);
    });

    it("drops samples outside the window", () => {
      tracker.add(500, 0);

      expect(tracker.getRateAt(6000)).toBe(0);
    });

    it("sums multiple samples within the window", () => {
      tracker.add(100, 0);
      tracker.add(100, 1000);
      tracker.add(100, 2000);

      expect(tracker.getRateAt(3000)).toBe(60);
    });
  });

  describe("data snapshot", () => {
    it("returns current total and rate", () => {
      tracker.add(150, 1000);
      tracker.add(50, 4000);

      expect(tracker.getData()).toEqual({ total: 200, rate: 40 });
    });
  });

  describe("reset", () => {
    it("resets total and rate", () => {
      tracker.add(500, 0);

      tracker.reset();

      expect(tracker.getData()).toEqual({ total: 0, rate: 0 });
    });
  });
});
