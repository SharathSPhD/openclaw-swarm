import crypto from "node:crypto";

export class TelegramRelay {
  constructor({ botToken, defaultChatId, maxRetries = 3, retryBaseMs = 1200 }) {
    this.botToken = botToken;
    this.defaultChatId = defaultChatId;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
  }

  async send({ text, chatId }) {
    if (!this.botToken || !(chatId || this.defaultChatId)) {
      return { ok: false, reason: "telegram_not_configured" };
    }

    const target = chatId || this.defaultChatId;
    const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: target, text, disable_web_page_preview: true })
        });

        const data = await res.json();
        if (res.ok && data.ok) {
          return {
            ok: true,
            deliveryId: crypto.randomUUID(),
            chatId: String(target),
            messageId: data?.result?.message_id,
            response: data
          };
        }
      } catch {
        // Retry path handled below.
      }

      if (attempt < this.maxRetries) {
        const wait = this.retryBaseMs * (attempt + 1);
        await new Promise((resolve) => setTimeout(resolve, wait));
      }
    }

    return { ok: false, reason: "telegram_send_failed" };
  }
}
