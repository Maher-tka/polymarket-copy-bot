import { BotConfig } from "../types";
import { logger } from "../logger";

export type TelegramAlertType =
  | "copy_signal"
  | "trade_simulated"
  | "trade_skipped"
  | "daily_loss_limit"
  | "bot_error"
  | "manual_approval";

export class TelegramNotifier {
  private readonly enabled: boolean;

  constructor(private readonly config: Pick<BotConfig, "telegramBotToken" | "telegramChatId">) {
    this.enabled = Boolean(config.telegramBotToken && config.telegramChatId);
  }

  async send(type: TelegramAlertType, message: string): Promise<void> {
    if (!this.enabled) return;

    const token = this.config.telegramBotToken;
    const chatId = this.config.telegramChatId;
    if (!token || !chatId) return;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `[${type}] ${message}`,
          disable_web_page_preview: true
        })
      });

      if (!response.ok) {
        throw new Error(`Telegram API returned ${response.status}`);
      }
    } catch (error) {
      logger.warn("Telegram alert failed.", { error: error instanceof Error ? error.message : String(error) });
    }
  }
}
