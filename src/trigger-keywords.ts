export type Warn = (message: string, ...details: unknown[]) => void;

export function parseTriggerKeywords(
  raw: string | undefined,
  warn: Warn = console.warn
): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    warn("Invalid JSON in TRIGGER_KEYWORDS. Keywords are disabled.", error);
    return [];
  }

  if (!isStringArray(parsed)) {
    warn(
      'TRIGGER_KEYWORDS must be a JSON array of strings, e.g. ["dify"]. Keywords are disabled.'
    );
    return [];
  }
  return parsed;
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}
