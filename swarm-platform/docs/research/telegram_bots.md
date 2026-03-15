Short answer: they can’t auto‑get new Telegram IDs; you use one bot + user chat, and agents talk to each other inside OpenClaw rather than as separate Telegram users. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/124105096/075e38fc-b47e-455a-b9a8-40880c92fa81/USAGE.md)

In OpenClaw’s model, Telegram is a **channel** for a human user, identified by a phone/user id (`--channel telegram --to +<USER_ID>`), mapped to an agent like `main` or `coordinator`. Spawning sub‑agents or sub‑sessions is done inside OpenClaw (via sessions, tools, files), not by registering new Telegram accounts. There is no supported flow where OpenClaw programmatically creates new Telegram users/bots and assigns them to spawned agents; you would need to pre‑create any additional bots in BotFather and configure them manually under `channels.telegram` in `openclaw.json`. [ppl-ai-file-upload.s3.amazonaws](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/124105096/075e38fc-b47e-455a-b9a8-40880c92fa81/USAGE.md)

For inter‑agent communication without user setup, use:

- Internal messaging APIs (e.g., sessions or tools that let agents send messages to each other by agent/session id).
- Shared filesystem (`/data`) where agents read/write task files, notes, and status.
- A single Telbot chat as the human interface; only the coordinator speaks on Telegram, and it routes work to other agents internally.

Do you want an example of an internal “mailbox” pattern where agents message each other via files and a small router agent, without touching Telegram at all?  