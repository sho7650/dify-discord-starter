import { describe, expect, it } from "vitest";
import { ChatConfig, ChatHandlers } from "./chat-handlers";
import { parseTriggerKeywords } from "./trigger-keywords";
import {
  BOT_ID,
  defaultConfig,
  fakeDify,
  fakeMessage,
} from "./test-support/fakes";

function createHandlers(
  config: Partial<ChatConfig> = {},
  dify = fakeDify().dify
) {
  return new ChatHandlers({
    botUserId: BOT_ID,
    dify,
    config: { ...defaultConfig, ...config },
  });
}

describe("ChatHandlers", () => {
  describe("public exchange", () => {
    it("replies with the Dify answer when the bot is mentioned", async () => {
      const { dify, requests } = fakeDify("hi from dify");
      const message = fakeMessage({ content: `<@${BOT_ID}> hello` });

      await createHandlers({}, dify).handleMessage(message);

      expect(requests).toHaveLength(1);
      expect(requests[0].query).toBe(" hello");
      expect(message.reply).toHaveBeenCalledWith(
        expect.objectContaining({ content: "hi from dify" })
      );
    });
  });

  describe("trigger keywords", () => {
    it("keeps answering mentions when TRIGGER_KEYWORDS was invalid", async () => {
      const triggerKeywords = parseTriggerKeywords("{}", () => {});
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({ triggerKeywords }, dify);

      await expect(
        handlers.handleMessage(
          fakeMessage({ content: "dify?", mentionsBot: false })
        )
      ).resolves.toBeUndefined();
      await handlers.handleMessage(fakeMessage());

      expect(requests).toHaveLength(1);
    });
  });
});
