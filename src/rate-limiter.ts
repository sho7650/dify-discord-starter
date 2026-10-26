/** `rejected` is the first rejection in a window, `rejected-again` any later one. */
export type RateLimitResult = "allowed" | "rejected" | "rejected-again";

export interface RateLimiterOptions {
  /** Calls allowed per user in one window; 0 disables the limit. */
  max: number;
  windowSec: number;
  now?: () => number;
}

interface Window {
  startedAt: number;
  count: number;
}

/** Counts each user's calls in fixed windows that start at their first call. */
export class RateLimiter {
  private readonly windows = new Map<string, Window>();
  private readonly now: () => number;

  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? Date.now;
  }

  public consume(userId: string): RateLimitResult {
    const { max } = this.options;
    if (max === 0) return "allowed";

    const window = this.advance(this.currentWindow(userId));
    this.windows.set(userId, window);
    if (window.count <= max) return "allowed";
    return window.count === max + 1 ? "rejected" : "rejected-again";
  }

  private currentWindow(userId: string): Window {
    const now = this.now();
    const window = this.windows.get(userId);
    const isExpired =
      !window || now - window.startedAt >= this.options.windowSec * 1000;
    return isExpired ? { startedAt: now, count: 0 } : window;
  }

  private advance(window: Window): Window {
    return { ...window, count: window.count + 1 };
  }
}
