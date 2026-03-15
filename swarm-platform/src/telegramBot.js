const HELP_TEXT = `*OpenClaw Swarm Bot*

Commands:
/objective <text> — Dispatch an objective to the swarm coordinator
/status — Show current swarm status
/pause <team> — Pause a team (e.g., /pause team-alpha)
/resume <team> — Resume a paused team
/agents — List active agents
/cancel <taskId> — Cancel a running task
/help — Show this help message

You can also send plain text to dispatch it as an objective.`;

export class TelegramBot {
  constructor({ botToken, allowedChatIds, onObjective, onCommand, db }) {
    this.botToken = botToken;
    this.allowedChatIds = new Set((allowedChatIds || []).map(String));
    this.onObjective = onObjective || (async () => {});
    this.onCommand = onCommand || (async () => {});
    this.db = db;
    this.offset = 0;
    this.running = false;
    this.pollIntervalMs = 1000;
    this.outboundQueue = [];
    this.lastSendTs = 0;
  }

  start() {
    if (!this.botToken || this.running) return;
    this.running = true;
    this._pollLoop();
  }

  stop() {
    this.running = false;
  }

  async _pollLoop() {
    while (this.running) {
      try {
        await this.poll();
        this.pollIntervalMs = Math.max(1000, this.pollIntervalMs / 2);
      } catch (err) {
        console.warn("[telegramBot] poll error:", err?.message || err);
        this.pollIntervalMs = Math.min(30000, this.pollIntervalMs * 2);
      }
      await new Promise((r) => setTimeout(r, this.pollIntervalMs));
    }
  }

  async poll() {
    if (!this.botToken) return;
    const url = `https://api.telegram.org/bot${this.botToken}/getUpdates`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        offset: this.offset,
        timeout: 30,
        allowed_updates: ["message"]
      })
    });
    const data = await res.json();
    if (data.ok && data.result?.length) {
      for (const update of data.result) {
        this.offset = update.update_id + 1;
        try {
          await this.handleUpdate(update);
        } catch (err) {
          console.warn("[telegramBot] handleUpdate error:", err?.message || err);
        }
      }
    }
  }

  async handleUpdate(update) {
    const msg = update.message;
    if (!msg?.text || !msg?.chat?.id) return;

    const chatId = String(msg.chat.id);
    if (!this.allowedChatIds.has(chatId)) return;

    const text = msg.text.trim();

    if (this.db) {
      await this.db.insertTelegramMessage({
        direction: "inbound",
        chatId,
        messageText: text,
        command: text.startsWith("/") ? text.split(" ")[0] : null
      });
    }

    if (text.startsWith("/objective ")) {
      const objective = text.slice("/objective ".length).trim();
      if (objective.length < 5) {
        await this.sendMessage(chatId, "Objective too short. Minimum 5 characters.");
        return;
      }
      await this.sendMessage(chatId, `Received objective. Dispatching to coordinator...\n\n_${objective}_`);
      await this.onObjective({ chatId, objective, fromUserId: msg.from?.id });
    } else if (text === "/status") {
      await this.onCommand({ chatId, command: "status" });
    } else if (text.startsWith("/pause ")) {
      const teamId = text.slice("/pause ".length).trim();
      await this.onCommand({ chatId, command: "pause", teamId });
    } else if (text.startsWith("/resume ")) {
      const teamId = text.slice("/resume ".length).trim();
      await this.onCommand({ chatId, command: "resume", teamId });
    } else if (text === "/agents") {
      await this.onCommand({ chatId, command: "agents" });
    } else if (text.startsWith("/cancel ")) {
      const taskId = text.slice("/cancel ".length).trim();
      await this.onCommand({ chatId, command: "cancel", taskId });
    } else if (text === "/help") {
      await this.sendMessage(chatId, HELP_TEXT);
    } else if (!text.startsWith("/")) {
      if (text.length >= 5) {
        await this.sendMessage(chatId, `Treating as objective. Dispatching...\n\n_${text}_`);
        await this.onObjective({ chatId, objective: text, fromUserId: msg.from?.id });
      }
    }
  }

  async sendMessage(chatId, text, parseMode = "Markdown") {
    const now = Date.now();
    const minInterval = 35;
    const wait = Math.max(0, this.lastSendTs + minInterval - now);
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    try {
      const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text,
          parse_mode: parseMode,
          disable_web_page_preview: true
        })
      });
      this.lastSendTs = Date.now();
      const data = await res.json();

      if (this.db) {
        await this.db.insertTelegramMessage({
          direction: "outbound",
          chatId,
          messageText: text
        });
      }

      return data;
    } catch (err) {
      return { ok: false, error: err?.message || err };
    }
  }

  async sendProgress(chatId, objectiveId, progress) {
    const shortId = (objectiveId || "").slice(0, 12);
    let text;

    switch (progress?.phase) {
      case "decomposing":
        text = `🔍 *Objective ${shortId}*\nDecomposing into sub-tasks...`;
        break;
      case "dispatching":
        text = `🚀 *Objective ${shortId}*\nDispatching wave ${progress.wave}:\n${(progress.subTasks || []).map((s) => `  • ${s.role}: ${(s.description || "").slice(0, 60)}`).join("\n")}`;
        break;
      case "executing":
        text = `⚡ *Objective ${shortId}*\nExecuting: ${progress.completedTasks || 0}/${progress.totalTasks || 0} tasks complete`;
        break;
      case "reviewing":
        text = `🔬 *Objective ${shortId}*\nCritic reviewing (iteration ${progress.iteration || 1})...`;
        break;
      case "aggregating":
        text = `📋 *Objective ${shortId}*\nAggregating final output...`;
        break;
      case "completed":
        text = `✅ *Objective ${shortId}* — COMPLETED\n\n${(progress.summary || "").slice(0, 500)}`;
        break;
      case "failed":
        text = `❌ *Objective ${shortId}* — FAILED\n\nReason: ${progress.error || "unknown"}`;
        break;
      default:
        text = `*Objective ${shortId}*: ${progress?.phase || "unknown"}`;
    }

    await this.sendMessage(chatId, text);
  }
}
