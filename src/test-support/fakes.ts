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

type StreamCallbacks = Parameters<DifyChat["streamChatMessage"]>[1];
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
}

export function fakeMessage({
  content = `<@${BOT_ID}> hello`,
  authorId = "user-a",
  authorIsBot = false,
  channelId = "channel-1",
  guildId = "guild-1",
  mentionsBot = true,
}: FakeMessageOptions = {}) {
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
    mentions: { has: (userId: string) => mentionsBot && userId === BOT_ID },
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
    replied: false,
    options: { getString: (_name: string, _required: true) => message },
    deferReply: vi.fn(async (_options: unknown) => ({})),
    editReply: vi.fn(async (_options: unknown) => ({})),
    followUp: vi.fn(async (_options: unknown) => ({})),
    reply: vi.fn(async (_options: unknown) => ({})),
  } satisfies IncomingCommand;
  return command;
}
