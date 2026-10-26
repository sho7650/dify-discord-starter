import { describe, expect, it } from "vitest";
import { ChatConfig, ChatHandlers, RATE_LIMIT_REPLY } from "./chat-handlers";
import { RateLimiter } from "./rate-limiter";
import { parseTriggerKeywords } from "./trigger-keywords";
import {
  BOT_ID,
  defaultConfig,
  fakeCommand,
  fakeDify,
  fakeMessage,
} from "./test-support/fakes";

function createHandlers(
  config: Partial<ChatConfig> = {},
  dify = fakeDify().dify,
  rateLimiter = new RateLimiter({ max: 10, windowSec: 60 })
) {
  return new ChatHandlers({
    botUserId: BOT_ID,
    dify,
    config: { ...defaultConfig, ...config },
    rateLimiter,
  });
}

async function mentionTimes(
  handlers: ChatHandlers,
  times: number,
  options: Parameters<typeof fakeMessage>[0] = {}
) {
  const messages = Array.from({ length: times }, () => fakeMessage(options));
  for (const message of messages) await handlers.handleMessage(message);
  return messages;
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

  describe("mentions", () => {
    it.each([
      ["@everyone/@here", { mentionsEveryone: true }],
      ["a role the bot has", { mentionsBotRole: true }],
    ])(
      "does not call Dify for a mention of %s alone",
      async (_label, mention) => {
        const { dify, requests } = fakeDify();
        const message = fakeMessage({
          content: "hello all",
          mentionsBot: false,
          ...mention,
        });

        await createHandlers(
          { messageContentAllowed: false },
          dify
        ).handleMessage(message);

        expect(requests).toHaveLength(0);
        expect(message.reply).not.toHaveBeenCalled();
      }
    );

    it.each([
      ["a direct mention", { mentionsBot: true }],
      ["a reply that pings the bot", { repliesToBot: true, replyPings: true }],
      ["a reply that does not ping the bot", { repliesToBot: true }],
    ])("calls Dify for %s", async (_label, mention) => {
      const { dify, requests } = fakeDify();
      const message = fakeMessage({
        content: "hello",
        mentionsBot: false,
        ...mention,
      });

      await createHandlers(
        { messageContentAllowed: false },
        dify
      ).handleMessage(message);

      expect(requests).toHaveLength(1);
    });

    it("ignores messages sent by bots", async () => {
      const { dify, requests } = fakeDify();

      await createHandlers({}, dify).handleMessage(
        fakeMessage({ authorIsBot: true })
      );

      expect(requests).toHaveLength(0);
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

  describe("conversation scope", () => {
    it.each(["user", "channel"])(
      "%s mode: does not carry a DM conversation into a public channel",
      async (historyMode) => {
        const { dify, requests } = fakeDify();
        const handlers = createHandlers({ historyMode }, dify);

        await handlers.handleMessage(
          fakeMessage({ channelId: "dm-1", guildId: null })
        );
        await handlers.handleMessage(fakeMessage({ channelId: "channel-1" }));

        expect(requests.map((r) => r.conversation_id)).toEqual(["", ""]);
      }
    );

    it.each(["user", "channel"])(
      "%s mode: continues the conversation for the same user in the same place",
      async (historyMode) => {
        const { dify, requests } = fakeDify();
        const handlers = createHandlers({ historyMode }, dify);

        await handlers.handleMessage(fakeMessage());
        await handlers.handleMessage(fakeMessage());
        await handlers.handleCommand(fakeCommand());
        await handlers.handleCommand(fakeCommand());

        expect(requests.map((r) => r.conversation_id)).toEqual([
          "",
          "conv-1",
          "",
          "conv-2",
        ]);
      }
    );

    it.each(["user", "channel"])(
      "%s mode: keeps /chat and the public exchange as separate conversations",
      async (historyMode) => {
        const { dify, requests } = fakeDify();
        const handlers = createHandlers({ historyMode }, dify);

        await handlers.handleMessage(fakeMessage());
        await handlers.handleCommand(fakeCommand());

        expect(requests.map((r) => r.conversation_id)).toEqual(["", ""]);
      }
    );

    it("channel mode: keeps one user's /chat away from other users", async () => {
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({ historyMode: "channel" }, dify);

      await handlers.handleCommand(fakeCommand({ userId: "user-a" }));
      await handlers.handleMessage(fakeMessage({ authorId: "user-b" }));
      await handlers.handleCommand(fakeCommand({ userId: "user-b" }));

      expect(requests.map((r) => r.conversation_id)).toEqual(["", "", ""]);
    });

    it("channel mode: shares the public exchange among users of a place", async () => {
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({ historyMode: "channel" }, dify);

      await handlers.handleMessage(fakeMessage({ authorId: "user-a" }));
      await handlers.handleMessage(fakeMessage({ authorId: "user-b" }));

      expect(requests.map((r) => r.conversation_id)).toEqual(["", "conv-1"]);
    });

    it.each(["user", "channel"])(
      "%s mode: /new-conversation restarts the caller's public and private conversations",
      async (historyMode) => {
        const { dify, requests } = fakeDify();
        const handlers = createHandlers({ historyMode }, dify);
        await handlers.handleMessage(fakeMessage());
        await handlers.handleCommand(fakeCommand());

        await handlers.handleCommand(
          fakeCommand({ commandName: "new-conversation" })
        );
        await handlers.handleMessage(fakeMessage());
        await handlers.handleCommand(fakeCommand());

        expect(requests.map((r) => r.conversation_id)).toEqual([
          "",
          "",
          "",
          "",
        ]);
      }
    );

    it.each(["user", "channel"])(
      "%s mode: /new-conversation keeps other users' private conversations and other places",
      async (historyMode) => {
        const { dify, requests } = fakeDify();
        const handlers = createHandlers({ historyMode }, dify);
        const otherUsersChat = () =>
          fakeCommand({ userId: "user-b", channelId: "channel-1" });
        const callerElsewhere = () =>
          fakeMessage({ authorId: "user-a", channelId: "channel-2" });
        await handlers.handleCommand(otherUsersChat());
        await handlers.handleMessage(callerElsewhere());

        await handlers.handleCommand(
          fakeCommand({
            commandName: "new-conversation",
            userId: "user-a",
            channelId: "channel-1",
          })
        );
        await handlers.handleCommand(otherUsersChat());
        await handlers.handleMessage(callerElsewhere());

        expect(requests.map((r) => r.conversation_id)).toEqual([
          "",
          "",
          "conv-1",
          "conv-2",
        ]);
      }
    );
  });

  describe("rate limit", () => {
    it("does not call Dify for the 11th mention and notifies only once per window", async () => {
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({}, dify);

      const messages = await mentionTimes(handlers, 12);

      expect(requests).toHaveLength(10);
      expect(messages[10].reply).toHaveBeenCalledExactlyOnceWith(
        RATE_LIMIT_REPLY
      );
      expect(messages[11].reply).not.toHaveBeenCalled();
    });

    it("answers every /chat over the limit with an ephemeral notice", async () => {
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({}, dify);
      await mentionTimes(handlers, 10);

      const commands = [fakeCommand(), fakeCommand()];
      for (const command of commands) await handlers.handleCommand(command);

      expect(requests).toHaveLength(10);
      for (const command of commands) {
        expect(command.reply).toHaveBeenCalledExactlyOnceWith({
          content: RATE_LIMIT_REPLY,
          ephemeral: true,
        });
        expect(command.deferReply).not.toHaveBeenCalled();
      }
    });

    it("counts calls from different servers as the same user", async () => {
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({}, dify);
      await mentionTimes(handlers, 10, { guildId: "guild-1" });

      await mentionTimes(handlers, 1, {
        guildId: "guild-2",
        channelId: "channel-2",
      });

      expect(requests).toHaveLength(10);
    });

    it("does not count /new-conversation", async () => {
      const { dify, requests } = fakeDify();
      const handlers = createHandlers({}, dify);
      for (let i = 0; i < 10; i++) {
        await handlers.handleCommand(
          fakeCommand({ commandName: "new-conversation" })
        );
      }

      await mentionTimes(handlers, 10);

      expect(requests).toHaveLength(10);
    });
  });
});
