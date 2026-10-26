import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { installCrashHandler } from "./crash-handler";

function fakeProcess() {
  return Object.assign(new EventEmitter(), { exit: vi.fn() });
}

describe("installCrashHandler", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("logs an unhandled rejection and exits with code 1", () => {
    const logError = vi.spyOn(console, "error").mockImplementation(() => {});
    const proc = fakeProcess();
    installCrashHandler(proc);
    const reason = new Error("boom");

    proc.emit("unhandledRejection", reason, Promise.resolve());

    expect(logError).toHaveBeenCalledWith(
      expect.stringMatching(/unhandled rejection/i),
      reason
    );
    expect(proc.exit).toHaveBeenCalledExactlyOnceWith(1);
  });
});
