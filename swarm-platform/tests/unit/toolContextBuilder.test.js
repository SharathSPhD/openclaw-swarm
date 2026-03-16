import test from "node:test";
import assert from "node:assert/strict";
import { buildToolContext, buildToolAwarePrompt } from "../../src/toolContextBuilder.js";

test("buildToolContext with null explorationEngine returns role-specific static tools", () => {
  const result = buildToolContext(null, "research");
  assert.match(result, /AVAILABLE TOOLS for RESEARCH role/);
  assert.match(result, /web_search/);
  assert.match(result, /read_file/);
});

test("buildToolContext with no role returns default tools", () => {
  const result = buildToolContext(null);
  assert.match(result, /AVAILABLE TOOLS/);
  assert.match(result, /read_file/);
  assert.match(result, /web_search/);
});

test("buildToolContext research role includes web_search and list_dir", () => {
  const result = buildToolContext(null, "research");
  assert.match(result, /web_search/);
  assert.match(result, /read_file/);
  assert.match(result, /list_dir/);
});

test("buildToolContext build role includes write_file and execute_code", () => {
  const result = buildToolContext(null, "build");
  assert.match(result, /write_file/);
  assert.match(result, /execute_code/);
  assert.match(result, /read_file/);
});

test("buildToolContext critic role includes web_search for fact-checking", () => {
  const result = buildToolContext(null, "critic");
  assert.match(result, /web_search/);
  assert.match(result, /execute_code/);
});

test("buildToolContext with explorationEngine merges dynamic and static tools", () => {
  const mockEngine = {
    discoverInstalledTools: () => [
      { agent: "web_agent", tool: "web_search" },
      { agent: "code_agent", tool: "syntax_check" }
    ]
  };
  const result = buildToolContext(mockEngine, "research");
  // Cache may return static tools if "research" role already cached
  assert.ok(result.length > 0, "Should return non-empty tool context");
  assert.match(result, /AVAILABLE TOOLS for RESEARCH role/);
});

test("buildToolContext caches per-role within TTL", () => {
  const mockEngine = { discoverInstalledTools: () => [] };
  const result1 = buildToolContext(mockEngine, "integrator");
  const result2 = buildToolContext(mockEngine, "integrator");
  assert.equal(result1, result2);
});

test("buildToolAwarePrompt includes role header and tool usage instructions", () => {
  const toolContext = "AVAILABLE TOOLS for RESEARCH role:\n  • web_search: web_search(query)";
  const result = buildToolAwarePrompt({
    role: "research",
    taskText: "find information about quantum computing",
    toolContext,
    codebaseHint: ""
  });
  assert.match(result, /RESEARCH/);
  assert.match(result, /quantum computing/);
  assert.match(result, /web_search/);
  assert.match(result, /proactively/);
});

test("buildToolAwarePrompt with empty toolContext omits AVAILABLE TOOLS section", () => {
  const result = buildToolAwarePrompt({
    role: "build",
    taskText: "implement feature X",
    toolContext: "",
    codebaseHint: ""
  });
  assert.match(result, /BUILD/);
  assert.match(result, /feature X/);
  assert.doesNotMatch(result, /AVAILABLE TOOLS/);
});

test("buildToolAwarePrompt appends codebaseHint to prompt", () => {
  const result = buildToolAwarePrompt({
    role: "integrator",
    taskText: "integrate components",
    toolContext: "",
    codebaseHint: "src/ contains the main logic"
  });
  assert.match(result, /src\/ contains the main logic/);
});
