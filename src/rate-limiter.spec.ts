import { describe, expect, it } from "vitest";
import { RateLimiter } from "./rate-limiter";

function limiterAt(clock: { now: number }, max = 10, windowSec = 60) {
  return new RateLimiter({ max, windowSec, now: () => clock.now });
}

function consumeTimes(limiter: RateLimiter, userId: string, times: number) {
  return Array.from({ length: times }, () => limiter.consume(userId));
}

describe("RateLimiter", () => {
  it("rejects the 11th call of a user within the window", () => {
    const limiter = limiterAt({ now: 0 });

    const results = consumeTimes(limiter, "user-a", 11);

    expect(results.slice(0, 10)).toEqual(Array(10).fill("allowed"));
    expect(results[10]).toBe("rejected");
  });

  it("allows calls again once the window has passed", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);
    consumeTimes(limiter, "user-a", 10);

    clock.now = 59_999;
    expect(limiter.consume("user-a")).toBe("rejected");
    clock.now = 60_000;
    expect(limiter.consume("user-a")).toBe("allowed");
  });

  it("tells the first rejection in a window apart from later ones", () => {
    const clock = { now: 0 };
    const limiter = limiterAt(clock);

    expect(consumeTimes(limiter, "user-a", 12).slice(10)).toEqual([
      "rejected",
      "rejected-again",
    ]);
    clock.now = 60_000;
    expect(consumeTimes(limiter, "user-a", 11)[10]).toBe("rejected");
  });

  it("never rejects when max is 0", () => {
    const limiter = limiterAt({ now: 0 }, 0);

    expect(consumeTimes(limiter, "user-a", 100)).toEqual(
      Array(100).fill("allowed")
    );
  });

  it("counts each user separately", () => {
    const limiter = limiterAt({ now: 0 });
    consumeTimes(limiter, "user-a", 10);

    expect(limiter.consume("user-b")).toBe("allowed");
  });
});
