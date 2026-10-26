import { describe, expect, it, vi } from "vitest";
import { parseTriggerKeywords } from "./trigger-keywords";

describe("parseTriggerKeywords", () => {
  it("uses a valid array of strings as-is", () => {
    const warn = vi.fn();

    expect(parseTriggerKeywords('["dify", "bot"]', warn)).toEqual([
      "dify",
      "bot",
    ]);
    expect(warn).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "[dify"],
    ["a JSON string", '"dify"'],
    ["a JSON object", "{}"],
    ["an array with a non-string element", '["dify", 1]'],
  ])("warns and disables keywords for %s", (_label, raw) => {
    const warn = vi.fn();

    expect(parseTriggerKeywords(raw, warn)).toEqual([]);
    expect(warn).toHaveBeenCalledOnce();
  });
});
