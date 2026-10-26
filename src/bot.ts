import { SlashCommandBuilder } from "@discordjs/builders";
import { REST } from "@discordjs/rest";
import { Routes } from "discord-api-types/v9";
import { Client, IntentsBitField } from "discord.js";
import * as dotenv from "dotenv";
import { ChatConfig, ChatHandlers } from "./chat-handlers";
import DifyChatClient from "./dify-client/dify-client";
import { RateLimiter } from "./rate-limiter";
import { parseTriggerKeywords } from "./trigger-keywords";

dotenv.config();

const DEFAULT_RATE_LIMIT_MAX = 10;
const DEFAULT_RATE_LIMIT_WINDOW_SEC = 60;

function readInteger(
  name: string,
  fallback: number,
  { min }: { min: number }
): number {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (Number.isInteger(value) && value >= min) return value;
  console.warn(`${name} must be an integer >= ${min}. Using ${fallback}.`);
  return fallback;
}

class DiscordBot {
  private client: Client;
  private difyClient: DifyChatClient;
  private handlers?: ChatHandlers;
  private readonly rateLimiter: RateLimiter;
  private readonly TOKEN: string;
  private readonly config: ChatConfig;

  constructor() {
    this.TOKEN = process.env.DISCORD_BOT_TOKEN || "";
    this.config = {
      historyMode: process.env.HISTORY_MODE || "",
      maxMessageLength: readInteger("MAX_MESSAGE_LENGTH", 2000, { min: 1 }),
      messageContentAllowed:
        String(process.env.MESSAGE_CONTENT_ALLOWED).toLowerCase() === "true",
      triggerKeywords: parseTriggerKeywords(process.env.TRIGGER_KEYWORDS),
    };

    this.rateLimiter = new RateLimiter({
      max: readInteger("RATE_LIMIT_MAX", DEFAULT_RATE_LIMIT_MAX, { min: 0 }),
      windowSec: readInteger(
        "RATE_LIMIT_WINDOW_SEC",
        DEFAULT_RATE_LIMIT_WINDOW_SEC,
        { min: 1 }
      ),
    });

    if (!this.TOKEN) {
      throw new Error("DISCORD_BOT_TOKEN must be provided in the .env file");
    }

    const intents = [
      IntentsBitField.Flags.Guilds,
      IntentsBitField.Flags.GuildMessages,
      IntentsBitField.Flags.DirectMessages,
    ];

    if (this.config.messageContentAllowed) {
      intents.push(IntentsBitField.Flags.MessageContent);
    }

    this.client = new Client({
      intents,
    });
    this.difyClient = new DifyChatClient();

    this.client.once("ready", (readyClient) => {
      this.handlers = new ChatHandlers({
        botUserId: readyClient.user.id,
        dify: this.difyClient,
        config: this.config,
        rateLimiter: this.rateLimiter,
      });
      console.log(
        "Discord bot is ready!",
        "Client ID:",
        readyClient.user.id,
        `\nInstall this bot to your server with this link: https://discord.com/api/oauth2/authorize?client_id=${readyClient.user.id}&permissions=0&scope=bot%20applications.commands `
      );
    });

    this.client.on("messageCreate", async (message) => {
      await this.handlers?.handleMessage(message);
    });

    this.client.on("interactionCreate", async (interaction) => {
      if (!interaction.isChatInputCommand()) return;
      await this.handlers?.handleCommand(interaction);
    });
  }

  public start() {
    return this.client.login(this.TOKEN);
  }

  public async installSlashCommand(guildId: string) {
    const commands = [
      new SlashCommandBuilder()
        .setName("chat")
        .setDescription(
          "Chat with the bot in private. No one but you will see this messasge or the bot response."
        )
        .addStringOption((option) =>
          option
            .setName("message")
            .setDescription("Your message.")
            .setRequired(true)
        )
        .toJSON(),
      new SlashCommandBuilder()
        .setName("new-conversation")
        .setDescription(
          "Start a new conversation with the bot. This will clear the chat history."
        )
        // .addStringOption(option =>
        //     option.setName('summarize')
        //         .setDescription('Summarize the current conversation history and take it over to the new conversation.')
        //         .setRequired(true))
        .toJSON(),
    ];

    const rest = new REST({ version: "9" }).setToken(this.TOKEN);

    try {
      console.log("Started refreshing application (/) commands.");

      await rest.put(
        Routes.applicationGuildCommands(this.client.user!.id, guildId),
        { body: commands }
      );

      console.log("Successfully reloaded application (/) commands.");
    } catch (error) {
      console.error(error);
    }
  }
}

export default DiscordBot;
