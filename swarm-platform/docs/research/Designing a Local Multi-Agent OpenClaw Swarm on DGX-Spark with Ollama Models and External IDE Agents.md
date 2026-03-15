# Designing a Local Multi-Agent OpenClaw Swarm on DGX-Spark with Ollama Models and External IDE Agents

## Executive Summary

This report describes how to architect and implement a multi-agent "swarm" on a DGX-Spark host running OpenClaw 2026.3.13 with Ollama-backed local models, Telegram (Telbot) as the primary chat surface, and optional coordination with external IDE agents such as VS Code Chat and GitHub Copilot. The focus is on:[^1][^2][^3]

- Using OpenClaw's agents, sessions, and tools APIs to implement a coordinator–specialist multi-agent pattern.
- Running all reasoning models locally via Ollama (gpt-oss, Nemotron, code-specialist models, etc.) while still enabling controlled web search through Brave or DDG-based skills.[^4][^3][^5]
- Letting external agents (Claude Code harness via Ollama, Copilot, Haiku) operate as "meta-orchestrators" that edit configuration, code, and workflows, while OpenClaw agents execute tasks autonomously.
- Establishing communication channels (Telegram, issues, files) between agents to support collaborative task execution.

The design emphasises safety: sandboxing, least-privilege tools, and human-in-the-loop checkpoints, while still allowing agents to plan, decompose, and carry out non-trivial tasks like writing and refactoring code, running experiments, and maintaining documentation.[^6][^7]

***

## Baseline System: DGX-Spark + OpenClaw + Ollama

### Hardware and Runtime Context

- **Host:** NVIDIA DGX-Spark with multiple GPUs; OpenClaw gateway runs as a systemd user service bound to `ws://127.0.0.1:18789`.[^1]
- **Model Serving:** Ollama is installed on the same host, default API at `http://localhost:11434`.[^2][^1]
- **Sandboxing:** OpenClaw uses Docker-based sandboxes; each Telegram session or agent session can run in a dedicated container, with workspace bind-mounted at `/data` inside the sandbox.[^1]
- **Web Tools:** When configured, `web_search` and `web_fetch` call Brave Search or other providers, with API keys stored in systemd environment variables (e.g. `BRAVE_API_KEY`).[^8][^1]

This environment already supports a single main agent (`main`) with Telegram integration (Telbot) and access to filesystem and selected tools, as described in the provided usage guide.[^1]

***

## Local Models on Ollama: Capabilities and Limits

### General Chat / Reasoning Models

Representative open models available in the Ollama library as of early 2026 include:[^9][^4][^2]

| Family | Example IDs | Strengths | Typical Context / Limits |
|--------|-------------|-----------|---------------------------|
| Llama 3.x / 3.2 | `llama3.1`, `llama3.2-90b` | Strong all-round reasoning, coding, multilingual; good default for coordinator agents. | Context up to ~256k tokens for larger variants; GPU-heavy at higher parameter counts. |
| Mistral / Mixtral | `mistral-7b`, `mixtral-8x22b` | Fast, good general assistant; MoE versions efficient for throughput. | Context typically 32–128k; MoE models need more VRAM but fewer active parameters. |
| Gemma 2 | `gemma2-9b`, `gemma2-27b` | Good for writing, chat, and some coding; from Google. | Context 8–32k; more constrained coding capability vs specialised coders. |
| Qwen / Qwen2 / Qwen3 | `qwen2-72b`, `qwen3-coder-30b` | Strong multilingual and code performance; some variants tuned for tools. | Context 32–128k; high VRAM usage above 30B. |
| DeepSeek Coder | `deepseek-coder-v2`, `deepseek-coder-v2.5` | Code-focused model; good for refactoring and tool-using code agents. | Context ~32–64k; weaker at general conversation. |
| LLaVA / LLaVA 1.6 | `llava-1.6-13b`, etc. | Vision + language; useful if you later expose images through workspace. | Limited mainly by GPU mem; requires image IO tools. |
| Granite / IBM Granite 3.0 | `granite-3.0-8b`, `granite-3.0-34b` | Enterprise-tuned models; good factuality for business tasks. | Context ~32k; often slower than Llama 3.x. |

### NVIDIA Nemotron and Other Large MoE Models

NVIDIA's Nemotron reasoning models are explicitly optimised for multi-agent workflows and are available on Ollama as `nemotron-3-super` (and possibly cloud-backed variants). These are mixture-of-experts models with 120B parameters but only ~12B active per token, plus very large contexts (up to 1M tokens), designed for planning and orchestration.[^5][^10]

Advantages of using Nemotron (or similar MoE models) for your coordinator agent:

- **Long-horizon planning:** Ability to keep large project briefs, design docs, and multi-agent state in context simultaneously.
- **Tool-calling support:** Optimised for agentic use cases, including tool schema following and function calling where supported by the runtime.[^3][^5]
- **Efficiency:** Active-parameter MoE architecture gives better latency than dense 120B models at similar quality.[^5]

Constraints:

- Needs significant GPU memory; on DGX-Spark this is feasible but still demands careful VRAM budgeting (e.g., one Nemotron coordinator plus several smaller worker models).
- Best used as a **single coordinator** or high-level planner, with smaller, faster models as workers.

### Code-Specialist Models for Worker Agents

For code editing, refactoring, and tool-heavy tasks, specialised models typically outperform general chat models. Useful choices include:[^2][^9]

- **DeepSeek Coder v2/v2.5** – high-quality code generation and refactoring; good with multi-file edits.
- **Qwen Coder or Qwen3-Coder-30B** – strong tool use and reasoning around build systems and configs.
- **MiniMax M2.5 (if available via Ollama or cloud)** – strong coding and agentic performance noted in practice.[^3]
- **OpenCoder**, `codeqwen`, or similar mid-size coding models for fast inner-loop editing.[^4][^9]

These can be used behind local Claude Code harness or VS Code tools through OpenAI-compatible endpoints exposed by Ollama.[^11][^3]

### Practical Limits

- **Context Windows:** Most open models offer 32–128k context; Nemotron and some long-context variants (e.g., certain Llama 3.x builds) extend this significantly but increase latency.[^3][^5]
- **Tool Calling:** Ollama has added support for tool calling compatible with OpenAI / Anthropic-style schemas for selected models; behaviour and reliability vary by family and fine-tuning.[^3]
- **GPU Budget:** Running multiple large models concurrently on DGX-Spark is feasible but should be planned (e.g., limit heavy models to a few agent roles and use smaller 7–13B models for most workers).[^10][^2]

***

## Target Architecture: OpenClaw Agent Swarm on DGX-Spark

### High-Level Pattern

A robust local "swarm" on top of OpenClaw can follow a **Coordinator + Specialist Squads** pattern, inspired by documented multi-agent architectures.[^7][^6]

Core components:

1. **Coordinator agent (`coordinator`)**
   - Runs on a strong reasoning model (e.g. `nemotron-3-super` or `llama3.1-70b`).
   - Connected to Telegram (Telbot) and/or VS Code Chat as the main human-facing interface.
   - Responsibilities: interpret objectives, break tasks into sub-tasks, spawn/route to specialists, track progress.

2. **Code specialist agents (`coder`, `reviewer`, `tester`)**
   - Backed by DeepSeek Coder, Qwen Coder, or similar; each has tool access (read/write/edit/process, tests) within `/data/projects/main`.
   - `coder`: implements new features, scripts, experiments.
   - `reviewer`: runs lint/tests, suggests improvements, guards safety constraints.
   - `tester`: automates test case generation and experiment orchestration.

3. **Research / web specialist agent (`researcher`)**
   - Uses `web_search` / `web_fetch` (Brave or DDG) as configured plus local RAG (via embeddings) for your documents.[^8][^1]
   - Summarises web content, writes briefs for other agents.

4. **Ops / tooling agent (`ops`)**
   - Handles CI-like routines: cleanup, log analysis, dataset management.
   - Limited shell access (process tool with safe command allowlist).

5. **Memory / knowledge base**
   - Shared via files under `/data/projects/main/notes` and a RAG index periodically rebuilt by `ops` using Ollama embeddings.[^7][^3]

Agents communicate via:

- **OpenClaw `sessions_send`/`message` tools** to send structured messages to each other.[^6]
- **Shared files** (e.g., `notes/*.md`, `tasks/*.json`) where they record plans, task state, and outputs.
- **Telegram** for human-in-the-loop oversight via Telbot.

### Example Agent Definitions (Conceptual)

In a higher-level OpenClaw config (or `AGENTS.md` / workspace agent manifests), the swarm could be described as:

```json
{
  "agents": {
    "defaults": { "model": { "primary": "ollama/gpt-oss:120b" } },
    "list": [
      {
        "id": "coordinator",
        "tools": { "profile": "full" },
        "systemPrompt": "You coordinate a team of specialist agents...",
        "model": { "primary": "ollama/nemotron-3-super" }
      },
      {
        "id": "coder",
        "tools": { "allow": ["read", "write", "edit", "process", "web_fetch"] },
        "model": { "primary": "ollama/deepseek-coder-v2" }
      },
      {
        "id": "reviewer",
        "tools": { "allow": ["read", "process"] },
        "model": { "primary": "ollama/qwen3-coder-30b" }
      },
      {
        "id": "researcher",
        "tools": { "allow": ["web_search", "web_fetch", "read", "write"] },
        "model": { "primary": "ollama/llama3.1" }
      }
    ]
  }
}
```

This sketch shows role separation, different tool scopes, and different underlying models for each specialist.

***

## Enabling Web Search in the Sandbox

Your provided USAGE guide confirms that OpenClaw 2026.3.13 expects **Brave Search** as the primary backend for `web_search`, with the API key stored in the systemd environment (`BRAVE_API_KEY`).[^8][^1]

Steps to fully enable web search from within sandboxes:

1. **Obtain Brave API key** from the Brave Search dashboard and store it only in the systemd environment:
   ```bash
   systemctl --user set-environment BRAVE_API_KEY="<your-key>"
   systemctl --user restart openclaw-gateway
   ```
   This avoids committing keys to source or shell history.[^1]

2. **Ensure sandbox network is functional** using the documented Docker test:
   ```bash
   docker run --rm --network bridge python:3.11-bookworm bash -c "curl -I https://example.com"
   ```
   If this works, the bridge network used by the sandbox can reach the internet.[^1]

3. **Turn on tools in the agent UI:** for each swarm agent that should search the web (e.g., `coordinator`, `researcher`), enable `web_search` and `web_fetch` tools in the Control UI Tools tab.[^1]

4. Optionally keep **DDG-based skills** (like `ddg-search`) enabled as fallbacks when Brave quota is exceeded; they route via `web_fetch` and do not need extra config, but still rely on sandbox networking.[^12][^13]

***

## Coordinator–Specialist Workflows and Autonomy

### Task Lifecycle

A typical autonomous workflow in the swarm is:

1. **Human objective intake (Telbot / VS Code Chat)**
   - You state a high-level goal, e.g. "Refactor the experiment runner to support distributed runs and generate a design doc." Telbot forwards this to `coordinator`.

2. **Planning by `coordinator`**
   - Uses long-context model to decompose the task: design doc, code changes, tests, documentation.
   - Creates or updates task files under `/data/projects/main/tasks/*.json` describing each sub-task, assignee agent, and status.
   - Sends structured messages via `sessions_send` to `coder`, `researcher`, `reviewer`, etc., referencing those files.[^6]

3. **Execution by specialists**
   - `researcher` uses `web_search` and RAG to gather patterns and best practices; writes `notes/design-research.md`.
   - `coder` reads notes and relevant source files, proposes patches using `edit` / `apply_patch` tools, and writes updates into the repo under `/data/projects/main/code`.
   - `tester` runs tests or experiments via `process` (with a safe command list like `pytest`, `python run_experiment.py`, etc.).

4. **Review and integration**
   - `reviewer` checks diffs, test logs, and design consistency; flags concerns back to `coordinator`.
   - `coordinator` produces a summary for you via Telbot and may open GitHub issues/PRs through external integrations (see below).

5. **Human approval loops**
   - Critical changes require your "approve & apply" response in Telegram or VS Code Chat before being merged or deployed.

### Autonomy Controls

Autonomy is bounded via:

- **Per-agent tool allowlists** – only selected agents may run shell commands or write files; others are read-only.[^7][^6]
- **Workspace confinement** – sandboxes only see `/data` (i.e., your workspace), not the whole host filesystem.[^1]
- **Task boards in files** – all planned/ongoing tasks stored in versioned JSON/Markdown; humans can audit and reset easily.

***

## Telbot and Inter-Agent Communication

### Telegram as Human–Swarm Interface

Telbot is currently wired as a front-end to the `main` or `coordinator` agent through the `channels.telegram` configuration. Messages from your Telegram account are routed to the designated agent and back.[^1]

For multi-agent coordination:

- Keep **one primary Telbot** mapped to `coordinator`.
- Allow `coordinator` to call `sessions_send` / `message` tools to create sub-sessions or sub-agents.
- Make subordinate agents "invisible" to Telegram by default; they operate via internal sessions and file I/O, which simplifies mental model.

### GitHub / Copilot as a Coordination Surface

GitHub Copilot Chat cannot create new GitHub accounts or change repository permissions; it operates under your GitHub identity and only where you already have rights.[^14][^15]

However, Copilot Chat can:

- Create issues and sub-issues that describe tasks for the OpenClaw swarm to work on, e.g., "Create an issue to refactor module X; assign to Copilot and tag 'openclaw-swarm'".[^14]
- Draft or update documentation (README, design docs) that agents will later consume via `/data`.
- Act as a **meta-orchestrator** by editing configuration files (`openclaw.json`, agent manifests, workflow YAMLs) in VS Code, based on your instructions and the architecture described in this report.[^15]

Your Telbot + Copilot workflow can be:

1. Describe a desired change in VS Code Chat.
2. Copilot edits config / code and opens issues representing sub-tasks.
3. OpenClaw agents, when triggered, read those issues (via local clones or API scripts) and implement them.
4. Copilot or Claude Code harness assists in reviewing resulting PRs.

***

## Claude Code Harness with Ollama Models

Anthropic's Claude Code harness supports self-hosted LLMs via compatible APIs, including Ollama models.[^11][^3]

A typical harness configuration for an Ollama-backed local model looks like:

```yaml
model_list:
  - model_name: local-deepseek
    litellm_params:
      model: ollama/deepseek-coder-v2
      api_base: "http://localhost:11434"
```

This allows you to:

- Use Claude Code's workflow engine (e.g., multi-file refactors, tests, run/debug) while all inference runs on your DGX-Spark via Ollama.[^11][^3]
- Integrate the harness with VS Code, so Haiku/Sonnet or other remote models can **co-exist** with local models; you can route simpler, privacy-sensitive tasks to local models.

You can conceptually treat Claude Code harness as another "agent team" that operates on the same repo under `/data/projects/main`, coordinated by the OpenClaw swarm via files and CI scripts.

***

## Security and Safety Considerations

### Sandboxing and Least Privilege

OpenClaw's default recommendation for shared systems is `sandbox.mode = "non-main"`, where main sessions may be unsandboxed but Telegram sessions are sandboxed. In your DGX-Spark setup you use sandboxed Telegram sessions with workspace-only access.[^1]

To preserve safety with increased autonomy:

- Keep sandbox mode as `"all"` or `"non-main"` with Telegram routed through sandboxes.
- Limit `process` tool commands to a curated list; avoid arbitrary shell execution.
- Store external API keys (Brave, Tavily, etc.) solely in systemd or environment, not in repo or workspace files.[^1]

### Network Restrictions

The usage guide notes that sandbox network is "restricted to web tools only" in bridge mode, meaning only whitelisted tools and containers can reach the internet. This is desirable for security; agents cannot exfiltrate arbitrary data via raw sockets.[^1]

Any additional network access (e.g., internal APIs) should be mediated through specific tools or scripts exposed as tools, not general `curl` from the sandbox.

### Human-in-the-Loop Controls

For "substantial autonomy" while retaining control:

- Require human approval for changes to security-sensitive files (config, credentials, deployment manifests).
- Use Git workflows: agents open PRs or branches; you or Copilot review and merge.
- Periodically reset sessions and clear old state via documented commands to avoid context drift.[^1]

***

## Example Objective Templates for the Swarm

To operationalise this architecture, define reusable "objective templates" you can give to `coordinator` via Telbot:

1. **Feature Development Objective**
   - "Design and implement feature X in project Y, including design doc, implementation, tests, and documentation. Use researcher for design input, coder for implementation, reviewer and tester for quality gates. Produce a final summary and diff overview."

2. **Refactoring / Debt Reduction Objective**
   - "Identify top three technical debt items in module M, propose refactorings, implement the safest one end-to-end, and create issues for the others."

3. **Experiment / Research Objective**
   - "Survey state-of-the-art techniques for Z, compare at least three approaches, prototype one in our codebase, and write a report in `/data/projects/main/notes/`."

4. **Documentation Improvement Objective**
   - "Audit existing docs, identify gaps, and produce updated README and API docs using code introspection and examples."

Each objective instructs the coordinator on when to involve you (checkpoints) and what artefacts to produce.

***

## Conclusion and Next Steps

A multi-agent OpenClaw swarm on DGX-Spark, backed entirely by Ollama-hosted open models including Nemotron, can provide powerful local autonomy for coding and research tasks while keeping data on-premises. The key ingredients are:[^10][^5][^3]

- A clear coordinator–specialist architecture using multiple agents with distinct roles and tools.[^6][^7]
- Proper sandboxing and web-search configuration (Brave or DDG skill + browser image) to enable safe, auditable internet access.[^8][^1]
- Integration with external IDE agents (VS Code Chat, Copilot, Claude Code harness) as meta-tools that help evolve configuration and workflows rather than replace the swarm.

Immediate practical steps include:

1. Finalise `openclaw.json` with Ollama models per agent and Brave API key for web tools.
2. Create agent manifests (`coordinator`, `coder`, `researcher`, `reviewer`, `ops`) and test a simple multi-agent objective end-to-end.
3. Wire Claude Code harness to a local code-specialist model and point it at the same `/data/projects/main` workspace.
4. Gradually increase agent autonomy by broadening tool access and automating more of the plan–execute–review loop, always retaining human approval for critical operations.

---

## References

1. [USAGE.md](https://ppl-ai-file-upload.s3.amazonaws.com/web/direct-files/attachments/124105096/075e38fc-b47e-455a-b9a8-40880c92fa81/USAGE.md?AWSAccessKeyId=ASIA2F3EMEYESNVJLM3F&Signature=1UGrVygLYFjvBKXV0BdMWzd0qKM%3D&x-amz-security-token=IQoJb3JpZ2luX2VjEPT%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FwEaCXVzLWVhc3QtMSJHMEUCIQC7oCRppmrYfuIycBX1Gk6ZwhjXtcrTiNngD%2Fdr%2BoS0NwIgbmTTO7XPKCNVov0e1%2FrHDDHdgxLzyF4hLYkyaVsytLYq%2FAQIvf%2F%2F%2F%2F%2F%2F%2F%2F%2F%2FARABGgw2OTk3NTMzMDk3MDUiDIpr1ddZ7%2BtoDlQSFSrQBDkpS7t8iDP1fdUPrs3fZUfg9FOsWJjhXDSiDhnEwPYFgBSnVcFBg1Sh%2FlDaVEiEGHYO2rE2u4yThnOknn3otRrEUX9ObNflQGumLWP94%2BBiare0OAG8oIxnhmshnGRBPDJ5xwCSHSCDTPv%2FauiBflmJeArGE2xbh81SUxax2%2FJvWWwDhNyacKnYcwwrcjMzkh%2Bi9clD4U9g8dXmv9dFeIkslNi%2Fm3eJKR9SzEwTWx0mY4P5wYqqDVprsz%2BjzTinS9kaHeQe1QHJ55SkBQ8dcvoczlwPXHHkv%2B%2FUU%2BIh%2FPfUnE0Nhc%2FOmfcxlUo1%2FzTJ85YC9k8FDq5c6lRgsGP5vuZvVHG48cYr6fvPlTbHipsFAmYDgz%2BhO5LtMa%2FyCarwATZSBY6g2znLMS0iTETYrOcCO86WvPaZlewtAwIq9uSJ3isb%2Fd3DZMh2MllJH43K1IfRdO%2B444ml6KqL1AGEiCKJRtEFEVaLdVScQaNOVAWuu0Z6DiWdbSNUX0q478ZFdyC2F4a9c9kZtJFCTupJIxA%2B6lzb6kp20XM3XTwryT8eoCZa2IJzOa%2B5oi20pOgBPFqh8xyCIOnswRAOX4mUBv9Y%2F4%2FF3Qihh6E%2FueXbMr0NBWCuTBzD0t8DC%2Bb%2Fmv1gLS%2BjJOkBcJG%2FClfdx9Lxi%2BEnFts2KLrv5iJYkOYBuvJs2np46oKsEWpInAHf%2B6UNQq9pbdRVnAUvXCziGzFjPzO3F4mkZRJIPk9iQTA%2FM%2BLHAgJLJKQlPHYZepOcZCEQF4tsK6aalCBewR%2ByN9kmoJIwgrjazQY6mAFVrRBrZiImiE6xq380c9j1U%2BwhkLqGGGxpEGSAB186gmUxBx5%2FOA6%2F0qIpfJZPPeVhDfnQdFBDWtJpZoSA31zXTOXlwU8KhtmBJ%2FF4LsRonV%2BgRxm4X8YHv%2F0kn3JnMr2ktR9lVGBDlOCsacPbMdly1G2vU78t8hwoOT%2FgPz6b%2FAMLMOJ%2BXrOGLZDW%2Fwa86CjgOK%2FrKDKoPg%3D%3D&Expires=1773578709) - # OpenClaw Usage Guide

OpenClaw v2026.3.13 - Agent framework with Telegram integration, web search,...

2. [Ollama Setup 2026 | Local LLM Guide](https://www.sitepoint.com/ollama-setup-guide-2026/) - Master Ollama in 2026 with this professional setup guide. Configure models, optimize performance, an...

3. [Blog · Ollama](https://ollama.com/blog) - January 16, 2026. Ollama is now compatible with the Anthropic Messages API, making it possible to us...

4. [library](https://ollama.com/library) - OpenCoder is an open and reproducible code LLM family which includes 1.5B and 8B models, supporting ...

5. [model nemotron-3-super:cloud Run it locally on your… | Ollama](https://www.linkedin.com/posts/ollama_nvidia-nemotron-3-super-is-now-available-activity-7437584421882560512-ZsHr) - NVIDIA Nemotron 3 Super is now available on Ollama. ollama run nemotron-3-super:cloud Try it with Op...

6. [OpenClaw Guide Ch6: Multi-Agent Collaboration Architecture](https://dev.to/linou518/openclaw-guide-ch6-multi-agent-collaboration-architecture-1hki) - Why Multi-Agent Architecture? A single Agent is powerful, but faces limitations in complex scenarios...

7. [Building Local AI Agents with Ollama and RAG - LinkedIn](https://www.linkedin.com/posts/susikumar-m_ai-localllm-rag-activity-7431997438535827456-dXtK) - Last time, I built an agent using an M365 Microsoft Copilot plug-in for TestCase Generator from JIRA...

8. [OpenClaw Web Search: How to Make Your Agent Actually Read the ...](https://www.firecrawl.dev/blog/openclaw-web-search) - To expand what your agent can do beyond web access, the best OpenClaw skills on ClawHub covers top p...

9. [Best AI Models You Can Run Locally with Ollama (2026 ...](https://www.youtube.com/watch?v=bzpRIF2Q16c) - In this video, we explore the **best AI models you can run locally using Ollama** on your laptop or ...

10. [NVIDIA Nemotron AI Models](https://developer.nvidia.com/nemotron) - Easily deploy models using open frameworks like vLLM, SGLang, Ollama and llama.cpp on any NVIDIA GPU...

11. [Support for Self-Hosted LLMs in Claude Code Harness · Issue #7178](https://github.com/anthropics/claude-code/issues/7178) - Enable Claude Code to integrate with self-hosted LLMs, allowing users to swap out Claude's proprieta...

12. [ddg-search](https://github.com/openclaw/skills/tree/main/skills/paradoxfuzzle/ddg-search/SKILL.md) - No information is available for this page.

13. [3 Ways to Configure OpenClaw Web Search: Make Your ...](https://help.apiyi.com/en/openclaw-web-search-configuration-guide-en.html) - The wizard will prompt you to enter your Brave Search API Key. Once configured, it'll be automatical...

14. [Using GitHub Copilot to create or update issues](https://docs.github.com/en/copilot/how-tos/use-copilot-for-common-tasks/use-copilot-to-create-or-update-issues) - Use Copilot to quickly generate structured, high-quality issues from natural language or images, wit...

15. [Set up GitHub Copilot in VS Code](https://code.visualstudio.com/docs/copilot/setup) - In the Accounts menu in the Activity Bar, select Manage Extension Account Preferences; Select GitHub...

