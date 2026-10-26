export interface CrashableProcess {
  on(
    event: "unhandledRejection",
    listener: (reason: unknown, promise: Promise<unknown>) => void
  ): unknown;
  exit(code: number): void;
}

/**
 * Exits on an unhandled rejection so the container restarts the bot instead of
 * leaving it running in an unknown state. Known failure points catch their own
 * errors; this is the safety net for the ones that slip through.
 */
export function installCrashHandler(proc: CrashableProcess): void {
  proc.on("unhandledRejection", (reason) => {
    console.error("Unhandled rejection, exiting:", reason);
    proc.exit(1);
  });
}
