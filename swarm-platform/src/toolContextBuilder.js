const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

// Role-specific tool definitions. These are the OpenClaw runtime tools available
// to each agent role regardless of openclaw.json configuration.
const ROLE_TOOLS = {
  research: [
    { name: "web_search", usage: "web_search(query: string) → search results", hint: "Use for current information, docs, APIs" },
    { name: "read_file", usage: "read_file(path: string) → file contents", hint: "Read any file in the workspace" },
    { name: "list_dir", usage: "list_dir(path: string) → directory listing", hint: "Explore project structure" },
  ],
  build: [
    { name: "read_file", usage: "read_file(path: string) → file contents", hint: "Read source files before modifying" },
    { name: "write_file", usage: "write_file(path: string, content: string) → ok", hint: "Create or overwrite files" },
    { name: "execute_code", usage: "execute_code(code: string, lang: string) → output", hint: "Run Python/shell to test logic" },
    { name: "list_dir", usage: "list_dir(path: string) → directory listing", hint: "Navigate the project" },
  ],
  critic: [
    { name: "read_file", usage: "read_file(path: string) → file contents", hint: "Review code/output files" },
    { name: "execute_code", usage: "execute_code(code: string, lang: string) → output", hint: "Verify logic by running it" },
    { name: "web_search", usage: "web_search(query: string) → search results", hint: "Fact-check claims, look up standards" },
  ],
  integrator: [
    { name: "read_file", usage: "read_file(path: string) → file contents", hint: "Read files to integrate" },
    { name: "write_file", usage: "write_file(path: string, content: string) → ok", hint: "Write integrated output" },
    { name: "execute_code", usage: "execute_code(code: string, lang: string) → output", hint: "Run tests/validation" },
    { name: "list_dir", usage: "list_dir(path: string) → directory listing", hint: "Find all relevant files" },
  ],
};

const DEFAULT_TOOLS = [
  { name: "read_file", usage: "read_file(path: string) → file contents", hint: "Read files in workspace" },
  { name: "web_search", usage: "web_search(query: string) → search results", hint: "Search the web for information" },
];

let toolContextCache = null;
let toolContextCachedAt = 0;

export function buildToolContext(explorationEngine, role) {
  const cacheKey = role || "default";
  const now = Date.now();

  // Per-role cache using a simple object
  if (!buildToolContext._cache) buildToolContext._cache = {};
  const cached = buildToolContext._cache[cacheKey];
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.value;
  }

  // Try dynamic discovery from explorationEngine first
  let dynamicTools = [];
  if (explorationEngine) {
    const discovered = explorationEngine.discoverInstalledTools();
    if (discovered && discovered.length > 0) {
      // Group by agent name
      const byAgent = {};
      for (const t of discovered) {
        if (!byAgent[t.agent]) byAgent[t.agent] = [];
        byAgent[t.agent].push(t.tool);
      }
      const lines = ["AVAILABLE TOOLS (discovered):"];
      for (const [agent, toolList] of Object.entries(byAgent)) {
        lines.push(`  Agent "${agent}": ${toolList.join(", ")}`);
      }
      dynamicTools = lines;
    }
  }

  // Fall back to role-specific static definitions (always populated)
  const roleTools = ROLE_TOOLS[role] || DEFAULT_TOOLS;
  const staticLines = [`AVAILABLE TOOLS for ${(role || "agent").toUpperCase()} role:`];
  for (const t of roleTools) {
    staticLines.push(`  • ${t.name}: ${t.usage}`);
    staticLines.push(`    → ${t.hint}`);
  }

  const allLines = dynamicTools.length > 0
    ? [...dynamicTools, "", ...staticLines]
    : staticLines;

  const result = allLines.join("\n");
  buildToolContext._cache[cacheKey] = { value: result, ts: now };
  return result;
}

export function buildToolAwarePrompt({ role, taskText, toolContext, codebaseHint }) {
  const toolSection = toolContext
    ? `\n\n${toolContext}\n\nINSTRUCTIONS FOR TOOL USE:\n- State the tool name and exact arguments explicitly in your response\n- For research tasks, ALWAYS use web_search when you need current information\n- For code tasks, use read_file before modifying, write_file to save changes\n- Use execute_code to verify logic with small test snippets\n- Tools are available — use them proactively, not just when stuck\n`
    : "";

  return `You are a ${role.toUpperCase()} agent in an autonomous swarm.\n${toolSection}\nTASK: ${taskText}${codebaseHint}`;
}
