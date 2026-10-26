import { vi } from "vitest";
import type { ChatMessageRequest } from "../dify-client/api.types";
import type { DifyChat } from "../answer-generator";
import type {
  ChatConfig,
  IncomingCommand,
  IncomingMessage,
} from "../chat-handlers";

export const BOT_ID = "bot-1";

export const defaultConfig: ChatConfig = {
  historyMode: "user",
  maxMessageLength: 2000,
  messageContentAllowed: true,
  triggerKeywords: [],
};

export type StreamCallbacks = Parameters<DifyChat["streamChatMessage"]>[1];
type StreamScript = (callbacks: StreamCallbacks) => Promise<void> | void;

/**
 * A Dify client that answers every request with `answer` in the conversation
 * `conv-<n>` (n counts the conversations it started), unless the request
 * continues an existing conversation. `script` replaces the default stream.
 */
export function fakeDify(answer = "hi from dify", script?: StreamScript) {
  const requests: ChatMessageRequest[] = [];
  let started = 0;
  const dify: DifyChat = {
    streamChatMessage: vi.fn(async (body: ChatMessageRequest, callbacks) => {
      requests.push(body);
      if (script) return script(callbacks);
      const conversationId = body.conversation_id || `conv-${++started}`;
      callbacks.onMessage(answer, true, { conversationId });
      callbacks.onCompleted?.();
    }),
  };
  return { dify, requests };
}

export interface FakeMessageOptions {
  content?: string;
  authorId?: string;
  authorIsBot?: boolean;
  channelId?: string;
  guildId?: string | null;
  mentionsBot?: boolean;
  mentionsEveryone?: boolean;
  mentionsBotRole?: boolean;
  repliesToBot?: boolean;
  /** Whether the reply pings the bot (Discord's "@ON" toggle). */
  replyPings?: boolean;
}

/**
 * Mirrors discord.js `MessageMentions`: `users` holds direct mentions plus the
 * replied-to user when the reply pings, `repliedUser` is set on any reply, and
 * `has()` with default options is also true for @everyone/@here and for roles
 * the bot has.
 */
function fakeMentions({
  mentionsBot = false,
  mentionsEveryone = false,
  mentionsBotRole = false,
  repliesToBot = false,
  replyPings = false,
}: FakeMessageOptions) {
  const users = new Set<string>();
  if (mentionsBot || (repliesToBot && replyPings)) users.add(BOT_ID);
  return {
    everyone: mentionsEveryone,
    users: { has: (userId: string) => users.has(userId) },
    repliedUser: repliesToBot ? { id: BOT_ID } : null,
    has: (userId: string) =>
      users.has(userId) ||
      (userId === BOT_ID && (mentionsEveryone || mentionsBotRole)),
  };
}

export function fakeMessage(options: FakeMessageOptions = {}) {
  const {
    content = `<@${BOT_ID}> hello`,
    authorId = "user-a",
    authorIsBot = false,
    channelId = "channel-1",
    guildId = "guild-1",
    mentionsBot = true,
  } = options;
  const message = {
    content,
    channelId,
    guildId,
    author: {
      id: authorId,
      bot: authorIsBot,
      username: authorId,
      globalName: null,
    },
    mentions: fakeMentions({ ...options, mentionsBot }),
    channel: { sendTyping: vi.fn(async () => {}) },
    reply: vi.fn(async (_options: unknown) => ({})),
  } satisfies IncomingMessage;
  return message;
}

export interface FakeCommandOptions {
  commandName?: string;
  message?: string;
  userId?: string;
  channelId?: string;
  guildId?: string | null;
}

export function fakeCommand({
  commandName = "chat",
  message = "hello",
  userId = "user-a",
  channelId = "channel-1",
  guildId = "guild-1",
}: FakeCommandOptions = {}) {
  const command = {
    commandName,
    channelId,
    guildId,
    user: { id: userId, username: userId, globalName: null },
    replied: false as boolean,
    options: { getString: (_name: string, _required: true) => message },
    deferReply: vi.fn(async (_options: unknown) => ({})),
    editReply: vi.fn(async (_options: unknown) => ({})),
    followUp: vi.fn(async (_options: unknown) => ({})),
    reply: vi.fn(async (_options: unknown) => ({})),
  } satisfies IncomingCommand;
  // Like discord.js, a successful editReply/followUp marks it as replied.
  const markReplied = (send: (typeof command)["editReply"]) => {
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (options) => {
      const result = await original(options);
      command.replied = true;
      return result;
    });
  };
  markReplied(command.editReply);
  markReplied(command.followUp);
  return command;
}
