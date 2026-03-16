const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

let toolContextCache = null;
let toolContextCachedAt = 0;

export function buildToolContext(explorationEngine) {
  const now = Date.now();
  if (toolContextCache && now - toolContextCachedAt < CACHE_TTL_MS) {
    return toolContextCache;
  }

  if (!explorationEngine) {
    toolContextCache = "";
    toolContextCachedAt = now;
    return toolContextCache;
  }

  const tools = explorationEngine.discoverInstalledTools();
  if (!tools || tools.length === 0) {
    toolContextCache = "";
    toolContextCachedAt = now;
    return toolContextCache;
  }

  // Group tools by agent
  const byAgent = {};
  for (const t of tools) {
    if (!byAgent[t.agent]) byAgent[t.agent] = [];
    byAgent[t.agent].push(t.tool);
  }

  const lines = ["AVAILABLE TOOLS:"];
  for (const [agent, toolList] of Object.entries(byAgent)) {
    lines.push(`  Agent "${agent}": ${toolList.join(", ")}`);
  }

  toolContextCache = lines.join("\n");
  toolContextCachedAt = now;
  return toolContextCache;
}

export function buildToolAwarePrompt({ role, taskText, toolContext, codebaseHint }) {
  const toolSection = toolContext
    ? `\n\n${toolContext}\n\nTo use a tool, state the tool name and arguments explicitly in your response.\nFor research tasks, use web_search when available.\n`
    : "";

  return `You are a ${role.toUpperCase()} agent in an autonomous swarm.\n${toolSection}\nTASK: ${taskText}${codebaseHint}`;
}
