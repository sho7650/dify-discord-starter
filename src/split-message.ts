export interface SplitMessageOptions {
  maxLength?: number;
}

const LINE_BREAK = "\n";

export function splitMessage(
  message: string,
  { maxLength = 2000 }: SplitMessageOptions = {}
): string[] {
  if (message.length <= maxLength) return [message];
  const parts = message
    .split(LINE_BREAK)
    .flatMap((line) => cutLongLine(line, maxLength));
  return parts.reduce<string[]>((messages, part) => {
    const last = messages[messages.length - 1];
    if (last === undefined) return [part];
    const joined = `${last}${LINE_BREAK}${part}`;
    return joined.length <= maxLength
      ? [...messages.slice(0, -1), joined]
      : [...messages, part];
  }, []);
}

function cutLongLine(line: string, maxLength: number): string[] {
  if (line.length <= maxLength) return [line];
  const cutAt = findCutIndex(line, maxLength);
  return [line.slice(0, cutAt), ...cutLongLine(line.slice(cutAt), maxLength)];
}

function findCutIndex(line: string, maxLength: number): number {
  const lastSpace = findLastSpaceIndex(line.slice(0, maxLength));
  if (lastSpace > 0) return lastSpace + 1;
  return isHighSurrogate(line.charCodeAt(maxLength - 1))
    ? maxLength - 1
    : maxLength;
}

function findLastSpaceIndex(text: string): number {
  for (let i = text.length - 1; i >= 0; i--) {
    if (/\s/.test(text[i])) return i;
  }
  return -1;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}
