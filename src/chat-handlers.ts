import type {
  InteractionEditReplyOptions,
  InteractionReplyOptions,
  MessageReplyOptions,
} from "discord.js";
import { ChatMessageRequest } from "./dify-client/api.types";
import { DifyFile } from "./dify-client/dify.types";
import { ConversationScope, ConversationStore } from "./conversation-store";
import {
  AnswerFile,
  DifyChat,
  GenerateAnswerOptions,
  generateAnswer,
} from "./answer-generator";

/** The parts of a discord.js `User` the handlers read. */
export interface ChatUser {
  id: string;
  username: string;
  globalName: string | null;
}

/** The parts of a discord.js `Message` the handlers use. */
export interface IncomingMessage {
  content: string;
  channelId: string;
  guildId: string | null;
  author: ChatUser & { bot: boolean };
  mentions: {
    users: { has(userId: string): boolean };
    repliedUser: { id: string } | null;
  };
  channel: { sendTyping?: () => Promise<void> };
  reply(options: string | MessageReplyOptions): Promise<unknown>;
}

/** The parts of a discord.js `ChatInputCommandInteraction` the handlers use. */
export interface IncomingCommand {
  commandName: string;
  channelId: string;
  guildId: string | null;
  user: ChatUser;
  replied: boolean;
  options: { getString(name: string, required: true): string };
  deferReply(options: { ephemeral: boolean }): Promise<unknown>;
  editReply(options: InteractionEditReplyOptions): Promise<unknown>;
  followUp(options: InteractionReplyOptions): Promise<unknown>;
  reply(options: string | InteractionReplyOptions): Promise<unknown>;
}

export interface ChatConfig {
  historyMode: string;
  maxMessageLength: number;
  messageContentAllowed: boolean;
  triggerKeywords: string[];
}

export interface ChatHandlersDeps {
  botUserId: string;
  dify: DifyChat;
  config: ChatConfig;
}

export const ERROR_REPLY =
  "Sorry, something went wrong while generating the answer.";

export class ChatHandlers {
  private readonly conversations: ConversationStore;

  constructor(private readonly deps: ChatHandlersDeps) {
    this.conversations = new ConversationStore(deps.config.historyMode);
  }

  public async handleMessage(message: IncomingMessage): Promise<void> {
    if (message.author.bot) return;

    const { messageContentAllowed, triggerKeywords } = this.deps.config;
    // Only a direct mention or a reply to the bot counts: @everyone, @here and
    // role mentions would otherwise let anyone fan out Dify calls.
    const { users, repliedUser } = message.mentions;
    const isMentioned =
      users.has(this.deps.botUserId) || repliedUser?.id === this.deps.botUserId;
    const isKeywordTriggered =
      messageContentAllowed &&
      triggerKeywords.some((keyword: string) =>
        message.content.toLowerCase().includes(keyword.toLowerCase())
      );

    if (isMentioned || isKeywordTriggered) {
      await this.handleChatMessage(message);
    }
  }

  public async handleCommand(interaction: IncomingCommand): Promise<void> {
    if (interaction.commandName === "chat") {
      await this.handleChatCommand(interaction);
    } else if (interaction.commandName === "new-conversation") {
      this.conversations.reset(interaction.channelId, interaction.user.id);
      await interaction.reply("New conversation started!");
    }
  }

  private async handleChatCommand(interaction: IncomingCommand) {
    await interaction.deferReply({ ephemeral: true });

    const scope: ConversationScope = {
      kind: "private",
      placeId: interaction.channelId,
      userId: interaction.user.id,
    };

    try {
      const { messages, files } = await this.generate(
        {
          inputs: {
            username: interaction.user.globalName || interaction.user.username,
            now: new Date().toUTCString(),
          },
          query: interaction.options.getString("message", true),
          response_mode: "streaming",
          conversation_id: this.conversations.find(scope),
          user: this.getUserId(
            interaction.user.id,
            interaction.guildId ?? undefined
          ),
        },
        scope,
        {
          handleChatflowAnswer: (chatflowMessages, files) => {
            if (chatflowMessages.length > 0) {
              this.sendInteractionAnswer(interaction, chatflowMessages, files);
            }
          },
        }
      );

      this.sendInteractionAnswer(interaction, messages, files);
    } catch (error) {
      console.error("Error sending message to Dify:", error);
      await interaction.editReply({ content: ERROR_REPLY });
    }
  }

  private sendInteractionAnswer(
    interaction: IncomingCommand,
    messages: string[],
    files?: DifyFile[]
  ) {
    for (const [index, m] of messages.entries()) {
      if (m.length === 0) continue;

      const additionalFields =
        index === 0 ? { files: files?.map(toAttachment) } : {};

      if (!interaction.replied && index === 0) {
        interaction.editReply({
          content: m,
          ...additionalFields,
        });
      } else {
        interaction.followUp({
          content: m,
          ephemeral: true,
          ...additionalFields,
        });
      }
    }
  }

  private async handleChatMessage(message: IncomingMessage) {
    const scope: ConversationScope = {
      kind: "public",
      placeId: message.channelId,
      userId: message.author.id,
    };

    message.channel.sendTyping?.().catch(console.error);

    try {
      const { messages, files } = await this.generate(
        {
          inputs: {
            username: message.author.globalName || message.author.username,
            now: new Date().toUTCString(),
          },
          query: message.content.replace(`<@${this.deps.botUserId}>`, ""),
          response_mode: "streaming",
          conversation_id: this.conversations.find(scope),
          user: this.getUserId(message.author.id, message.guildId ?? undefined),
        },
        scope,
        {
          onPing: async () => {
            await message.channel.sendTyping?.().catch(console.error);
          },
          handleChatflowAnswer: (chatflowMessages, files) => {
            if (chatflowMessages.length > 0) {
              this.sendChatAnswer(message, chatflowMessages, files);
            }
          },
        }
      );

      this.sendChatAnswer(message, messages, files);
    } catch (error) {
      console.error("Error sending message to Dify:", error);
      await message.reply(ERROR_REPLY);
    }
  }

  private sendChatAnswer(
    message: IncomingMessage,
    messages: string[],
    files?: DifyFile[]
  ) {
    for (const [index, m] of messages.entries()) {
      if (m.length === 0) continue;
      if (index === 0) {
        message.reply({
          content: m,
          files: files?.map(toAttachment),
        });
      } else {
        message.reply(m);
      }
    }
  }

  private generate(
    request: ChatMessageRequest,
    scope: ConversationScope,
    options: Pick<GenerateAnswerOptions, "onPing" | "handleChatflowAnswer">
  ) {
    return generateAnswer(this.deps.dify, request, {
      ...options,
      maxMessageLength: this.deps.config.maxMessageLength,
      onConversationId: (conversationId) => {
        this.conversations.remember(scope, conversationId);
      },
    });
  }

  private getUserId(userId: string | undefined, serverId: string | undefined) {
    switch (this.deps.config.historyMode) {
      case "user":
        return userId || "";
      case "channel":
        return serverId || "";
      default:
        return "";
    }
  }
}

function toAttachment(file: AnswerFile | DifyFile) {
  const extension = (file as DifyFile).extension;
  return {
    attachment: file.url,
    name: extension
      ? `generated_${file.type}.${extension}`
      : `generated_${file.type}`,
  };
}
