import DiscordBot from "./bot";
import { installCrashHandler } from "./crash-handler";

installCrashHandler(process);

const bot = new DiscordBot();
bot.start().catch((error) => {
  console.error("Failed to log in to Discord:", error);
  process.exit(1);
});
