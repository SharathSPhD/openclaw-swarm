import crypto from "node:crypto";

function escapeMd(text) {
  if (!text) return "";
  return String(text).replace(/[_*[\]()~`>#+=|{}.!-]/g, c => `\\${c}`);
}

export { escapeMd };

export class TelegramRelay {
  constructor({ botToken, defaultChatId, maxRetries = 3, retryBaseMs = 1200 }) {
    this.botToken = botToken;
    this.defaultChatId = defaultChatId;
    this.maxRetries = maxRetries;
    this.retryBaseMs = retryBaseMs;
  }

  async send({ text, chatId, parseMode = "MarkdownV2" }) {
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
          body: JSON.stringify({ chat_id: target, text, parse_mode: parseMode, disable_web_page_preview: true })
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

  async sendSwarmSummary({ store, roundResult, objectiveText, chatId }) {
    try {
      if (!store) {
        return { ok: false, reason: "store_not_provided" };
      }

      const target = chatId || this.defaultChatId;
      if (!this.botToken || !target) {
        return { ok: false, reason: "telegram_not_configured" };
      }

      // Get leaderboard for current scores
      const leaderboard = store.getLeaderboard?.() || [];
      
      // Build summary message
      const lines = [];
      lines.push("🏆 *Swarm Round Complete*");
      lines.push("");

      // Objective summary (first 100 chars)
      if (objectiveText) {
        const objectivePreview = objectiveText.length > 100 
          ? objectiveText.slice(0, 100) + "..." 
          : objectiveText;
        lines.push(`📋 *Objective:* ${objectivePreview}`);
        lines.push("");
      }

      // Winner info
      if (roundResult?.winner) {
        const winnerName = (roundResult.winner || "").replace("team-", "Team ").replace(/-/g, " ");
        const scoreDelta = roundResult.scoreDelta ?? "N/A";
        lines.push(`🥇 *Winner:* ${winnerName} (delta: +${scoreDelta})`);
        lines.push("");
      }

      // Leaderboard
      if (leaderboard && leaderboard.length > 0) {
        lines.push("📊 *Leaderboard:*");
        for (const entry of leaderboard.slice(0, 4)) {
          const name = (entry.teamName || entry.teamId || "Unknown").replace("Team ", "");
          const score = entry.score ?? "N/A";
          const completed = entry.completed ?? "N/A";
          const accuracy = entry.accuracy ? `${Math.round(entry.accuracy * 100)}%` : "N/A";
          
          const scoreStr = typeof score === "number" ? score.toLocaleString() : score;
          lines.push(`  ${name}: ${scoreStr} pts | ${completed} done | ${accuracy} acc`);
        }
        lines.push("");
      }

      // Metrics
      const metrics = [];
      if (roundResult?.avgLatency) {
        const latencySec = Math.round(roundResult.avgLatency / 1000);
        metrics.push(`⚡ Latency: ${latencySec}s`);
      }
      if (roundResult?.criticApprovalRate !== undefined) {
        const approvalPct = Math.round(roundResult.criticApprovalRate * 100);
        metrics.push(`🎯 Critic approval: ${approvalPct}%`);
      }
      if (metrics.length > 0) {
        lines.push(metrics.join(" | "));
      }

      const text = lines.join("\n");

      // Check message length (Telegram limit is 4096, we keep well under)
      if (text.length > 4000) {
        // If too long, truncate gracefully
        const truncated = text.slice(0, 3900) + "\n...[truncated]";
        return this.send({ text: truncated, chatId: target, parseMode: "MarkdownV2" });
      }

      return this.send({ text, chatId: target, parseMode: "MarkdownV2" });
    } catch (err) {
      console.error("[telegramRelay] sendSwarmSummary error:", err?.message);
      return { ok: false, reason: "summary_composition_failed", error: err?.message };
    }
  }

  async sendFormatted({ text, chatId }) {
    if (!this.botToken || !(chatId || this.defaultChatId)) {
      return { ok: false, reason: "telegram_not_configured" };
    }

    const target = chatId || this.defaultChatId;
    return this.send({ text, chatId: target, parseMode: "MarkdownV2" });
  }
}
