import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { splitMessage } from "./split-message";

const messageText = fc.string({
  unit: fc.oneof(
    fc.constantFrom("\n", " ", "　", "あ", "😀"),
    fc.string({ unit: "binary", minLength: 1, maxLength: 1 })
  ),
  maxLength: 300,
});

describe("splitMessage", () => {
  it("never throws and keeps every chunk within maxLength without breaking characters", () => {
    fc.assert(
      fc.property(
        messageText,
        fc.integer({ min: 2, max: 50 }),
        (text, maxLength) => {
          const chunks = splitMessage(text, { maxLength });

          for (const chunk of chunks) {
            expect(chunk.length).toBeLessThanOrEqual(maxLength);
            expect(chunk).not.toMatch(/\p{Cs}/u); // no lone surrogate
          }
          expect(chunks.join("").replaceAll("\n", "")).toBe(
            text.replaceAll("\n", "")
          );
        }
      )
    );
  });

  it("splits a Japanese line longer than maxLength with no newlines into several chunks without losing content", () => {
    const line = "あ".repeat(4500);

    const chunks = splitMessage(line, { maxLength: 2000 });

    expect(chunks).toEqual([
      "あ".repeat(2000),
      "あ".repeat(2000),
      "あ".repeat(500),
    ]);
  });

  it("does not break an emoji (surrogate pair) at a chunk boundary", () => {
    // "a" shifts every emoji so that one straddles the 10th UTF-16 unit
    const line = "a" + "😀".repeat(6);

    const chunks = splitMessage(line, { maxLength: 10 });

    expect(chunks).toEqual(["a😀😀😀😀", "😀😀"]);
  });

  it("breaks at the last space before the limit when there is one", () => {
    const line = "hello world foobar";

    const chunks = splitMessage(line, { maxLength: 14 });

    expect(chunks).toEqual(["hello world ", "foobar"]);
  });

  it("returns a message within maxLength as a single chunk, as before", () => {
    expect(splitMessage("hello\nworld", { maxLength: 2000 })).toEqual([
      "hello\nworld",
    ]);
  });

  it("packs newline-separated lines into chunks the same way as before", () => {
    const chunks = splitMessage("aaa\nbbb\nccc", { maxLength: 7 });

    expect(chunks).toEqual(["aaa\nbbb", "ccc"]);
  });
});
