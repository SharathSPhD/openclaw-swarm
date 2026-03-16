/**
 * Exploration Engine
 *
 * The program lead's assistant (team-delta) uses this to:
 * 1. Discover and catalog available OpenClaw skills/tools
 * 2. Generate external objectives beyond self-improvement
 * 3. Weigh and prioritize objectives based on system state
 * 4. Manage the skill ecosystem
 */

import fs from "node:fs";
import path from "node:path";

const OPENCLAW_HOME = process.env.OPENCLAW_HOME || path.join(process.env.HOME || "/root", ".openclaw");
const SKILL_CATALOG_PATH = path.join(OPENCLAW_HOME, "skills");
const WORKSPACE_SKILL_PATH = path.join(OPENCLAW_HOME, "workspace", "skills");

const EXTERNAL_OBJECTIVE_TEMPLATES = [
  {
    category: "security_audit",
    weight: 0.8,
    generator: () => "Perform a security audit of the swarm platform codebase. Check for: hardcoded secrets, SQL injection risks, unvalidated inputs in API endpoints, missing authentication on sensitive routes, and exposed debug endpoints. Report findings with severity and fix recommendations."
  },
  {
    category: "api_design",
    weight: 0.7,
    generator: () => "Review all REST API endpoints in server.js for consistency. Check: HTTP method correctness, response format uniformity, error handling patterns, status code usage, and missing CORS headers. Propose a standardized API response format."
  },
  {
    category: "code_quality",
    weight: 0.6,
    generator: () => "Analyze the swarm-platform codebase for code smells and refactoring opportunities. Focus on: duplicated logic, overly complex functions (>50 lines), missing error handling, inconsistent naming conventions, and dead code. Provide specific refactoring suggestions."
  },
  {
    category: "resilience",
    weight: 0.75,
    generator: () => "Design a resilience strategy for the swarm platform. Address: what happens when Ollama is down, how to handle partial task failures in a coordinator pipeline, implementing circuit breakers for model calls, and graceful degradation when GPU memory is exhausted."
  },
  {
    category: "monitoring",
    weight: 0.65,
    generator: () => "Design a comprehensive monitoring dashboard for the swarm platform. Include: task throughput over time, model error rates, GPU utilization trends, team performance comparison over rounds, and automated alerting thresholds. Specify metric collection points and visualization recommendations."
  },
  {
    category: "user_experience",
    weight: 0.5,
    generator: () => "Evaluate the swarm platform UI for usability improvements. Consider: information density on the dashboard, navigation flow between pages, real-time feedback for running objectives, mobile responsiveness, and accessibility. Propose 5 concrete UI improvements."
  },
  {
    category: "scalability",
    weight: 0.6,
    generator: () => "Analyze the swarm platform's scalability limits. Consider: maximum concurrent objectives, event store memory growth, WebSocket connection limits, database query performance under load, and model loading/unloading overhead. Propose specific solutions for each bottleneck."
  },
  {
    category: "knowledge_base",
    weight: 0.55,
    generator: () => "Design a knowledge base system for the swarm platform that persists insights from completed objectives. The system should: store actionable findings, tag them by domain, make them searchable by future objectives, and automatically include relevant past knowledge in new task prompts."
  }
];

export class ExplorationEngine {
  constructor({ db, store, teamLearning, specializationEngine, aiTechExplorer }) {
    this.db = db;
    this.store = store;
    this.teamLearning = teamLearning;
    this.specializationEngine = specializationEngine;
    this.aiTechExplorer = aiTechExplorer;
    this.explorationIndex = 0;
    this.completedExplorations = new Set();
    this.codebaseAnalysisCache = null;
    this.codebaseAnalysisCalls = 0;
  }

  _enhanceObjectiveWithAiTechContext(objective) {
    if (!this.aiTechExplorer) return objective;

    const aiTechSummary = this.aiTechExplorer.getSummaryForPrompt();
    return `${objective}\n\n---\n\n${aiTechSummary}`;
  }

  async _findUntestedFunctions() {
    const srcDir = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), 'src');
    const testDir = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), 'tests');

    const results = [];

    // Get all test file content to search for function names
    let testContent = "";
    try {
      const testFiles = fs.readdirSync(testDir, { recursive: true })
        .filter(f => f.endsWith(".js") || f.endsWith(".ts"))
        .map(f => path.join(testDir, f));
      for (const tf of testFiles.slice(0, 20)) {
        try { testContent += fs.readFileSync(tf, "utf8"); } catch { /* skip */ }
      }
    } catch { return results; }

    // Scan src files for exported functions
    try {
      const srcFiles = fs.readdirSync(srcDir)
        .filter(f => f.endsWith(".js") && !f.startsWith("_"))
        .slice(0, 15);

      for (const srcFile of srcFiles) {
        const filePath = path.join(srcDir, srcFile);
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const lines = content.split("\n");

          // Find exported functions
          const exportPattern = /^export\s+(?:async\s+)?function\s+(\w+)|^export\s+(?:const|let)\s+(\w+)\s*=/gm;
          let match;
          const exported = [];
          while ((match = exportPattern.exec(content)) !== null) {
            exported.push(match[1] || match[2]);
          }

          // Check which are not mentioned in tests
          const untested = exported.filter(fn => !testContent.includes(fn));

          if (untested.length > 0) {
            results.push({
              file: `swarm-platform/src/${srcFile}`,
              untestedFunctions: untested.slice(0, 5),
              totalExports: exported.length
            });
          }
        } catch { /* skip */ }
      }
    } catch { return results; }

    return results.slice(0, 5); // Top 5 files with untested exports
  }

  async _findApiEndpointsWithoutValidation() {
    const routesDir = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), 'src', 'routes');
    const results = [];

    try {
      const routeFiles = fs.readdirSync(routesDir).filter(f => f.endsWith(".js"));

      for (const routeFile of routeFiles) {
        const filePath = path.join(routesDir, routeFile);
        try {
          const content = fs.readFileSync(filePath, "utf8");
          const lines = content.split("\n");

          // Find POST/PUT/DELETE endpoints
          const endpointPattern = /app\.(post|put|delete|patch)\s*\(\s*["'`]([^"'`]+)["'`]/g;
          let match;
          const unvalidated = [];

          while ((match = endpointPattern.exec(content)) !== null) {
            const method = match[1].toUpperCase();
            const route = match[2];
            // Find the position and check nearby lines for validation
            const pos = match.index;
            const nearbyLines = content.slice(pos, pos + 400);
            const hasValidation = /validate|sanitize|schema|zod|joi|req\.body\?\./.test(nearbyLines);
            const hasReqBody = /req\.body/.test(nearbyLines);

            if (hasReqBody && !hasValidation) {
              // Find line number
              const lineNum = content.slice(0, pos).split("\n").length;
              unvalidated.push({ method, route, line: lineNum });
            }
          }

          if (unvalidated.length > 0) {
            results.push({
              file: `swarm-platform/src/routes/${routeFile}`,
              unvalidatedEndpoints: unvalidated.slice(0, 3)
            });
          }
        } catch { /* skip */ }
      }
    } catch { return results; }

    return results.slice(0, 4);
  }

  async _findAsyncWithoutErrorHandling() {
    const srcDir = path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'), 'src');
    const results = [];

    try {
      const files = fs.readdirSync(srcDir)
        .filter(f => f.endsWith(".js") && !f.startsWith("_"))
        .slice(0, 15);

      for (const file of files) {
        const filePath = path.join(srcDir, file);
        try {
          const content = fs.readFileSync(filePath, "utf8");

          // Find async functions by name
          const asyncFnPattern = /async\s+(?:function\s+)?(\w+)\s*\([^)]*\)\s*\{/g;
          let match;
          const unhandled = [];

          while ((match = asyncFnPattern.exec(content)) !== null) {
            const fnName = match[1];
            if (fnName === "function" || fnName.length < 3) continue;

            // Find the function body - look for try/catch within next 2000 chars
            const bodyStart = match.index + match[0].length;
            const bodySlice = content.slice(bodyStart, bodyStart + 2000);

            // Check if it has try/catch or .catch() or error handling
            const hasTryCatch = /try\s*\{/.test(bodySlice);
            const hasCatchCall = /\.catch\s*\(/.test(bodySlice);
            const hasAwait = /await\s/.test(bodySlice);

            if (hasAwait && !hasTryCatch && !hasCatchCall) {
              const lineNum = content.slice(0, match.index).split("\n").length;
              unhandled.push({ name: fnName, line: lineNum });
            }
          }

          if (unhandled.length > 0) {
            results.push({
              file: `swarm-platform/src/${file}`,
              functions: unhandled.slice(0, 3)
            });
          }
        } catch { /* skip */ }
      }
    } catch { return results; }

    return results.slice(0, 4);
  }

  _analyzeCodebase() {
    // Server runs from swarm-platform/ directory; __dirname is swarm-platform/src/
    const platformRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
    const srcDir = path.join(platformRoot, 'src');
    const testsDir = path.join(platformRoot, 'tests');
    
    const analysis = {
      todos: [],
      largeFiles: [],
      testGaps: [],
      errorHandlingGaps: [],
      performanceBottlenecks: [],
      apiValidationGaps: []
    };

    // Scan for TODO/FIXME/HACK/XXX comments
    const scanForComments = (dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory()) continue;
          if (!file.name.endsWith('.js')) continue;
          
          const filePath = path.join(dirPath, file.name);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            lines.forEach((line, idx) => {
              const match = line.match(/\b(TODO|FIXME|HACK|XXX)\b\s*:?\s*(.+)/);
              if (match) {
                analysis.todos.push({
                  file: path.relative(platformRoot, filePath),
                  line: idx + 1,
                  text: match[2].trim().slice(0, 100)
                });
              }
            });
          } catch { /* skip unreadable */ }
        }
      } catch { /* dir may not exist */ }
    };

    scanForComments(srcDir);

    // Find large functions (>300 lines)
    const scanForLargeFiles = (dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory()) continue;
          if (!file.name.endsWith('.js')) continue;
          
          const filePath = path.join(dirPath, file.name);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lineCount = content.split('\n').length;
            if (lineCount > 300) { // Large file threshold
              analysis.largeFiles.push({
                file: path.relative(platformRoot, filePath),
                lines: lineCount
              });
            }
          } catch { /* skip */ }
        }
      } catch { /* dir may not exist */ }
    };

    scanForLargeFiles(srcDir);

    // Check test coverage (test gaps)
    const getTestsForFile = (srcFile) => {
      const baseName = path.basename(srcFile, '.js');
      const testPatterns = [
        path.join(testsDir, 'unit', `${baseName}.test.js`),
        path.join(testsDir, 'integration', `${baseName}.integration.test.js`),
        path.join(testsDir, 'e2e', `${baseName}.e2e.test.js`)
      ];
      return testPatterns.some(p => fs.existsSync(p));
    };

    try {
      if (fs.existsSync(srcDir)) {
        const srcFiles = fs.readdirSync(srcDir, { withFileTypes: true });
        for (const file of srcFiles) {
          if (file.isDirectory() || !file.name.endsWith('.js')) continue;
          const srcPath = path.join(srcDir, file.name);
          const hasTest = getTestsForFile(srcPath);
          if (!hasTest && file.name !== 'server.js') { // server.js may have integration tests
            analysis.testGaps.push({
              srcFile: path.relative(platformRoot, srcPath),
              hasTest: false
            });
          }
        }
      }
    } catch { /* ok */ }

    // Scan for functions/methods without error handling (try/catch)
    const scanForErrorHandlingGaps = (dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory() || !file.name.endsWith('.js')) continue;
          
          const filePath = path.join(dirPath, file.name);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            let inFunction = false;
            let functionName = '';
            let functionStart = 0;
            let tryCatchCount = 0;
            let braceDepth = 0;
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              
              // Detect function/method declarations (async functions, class methods)
              if (/(async\s+)?function\s+\w+|^\s*async\s+\w+\s*\(|^\s*\w+\s*\([^)]*\)\s*{/.test(line)) {
                if (!inFunction) {
                  inFunction = true;
                  functionStart = i + 1;
                  functionName = line.match(/function\s+(\w+)|\b(\w+)\s*\(/)?.[1] || line.match(/\b(\w+)\s*\(/)?.[1] || 'unknown';
                  tryCatchCount = 0;
                  braceDepth = 0;
                }
              }
              
              if (inFunction) {
                braceDepth += (line.match(/{/g) || []).length;
                braceDepth -= (line.match(/}/g) || []).length;
                
                if (line.includes('try {') || line.includes('try{')) {
                  tryCatchCount++;
                }
                
                if (braceDepth <= 0 && line.includes('}')) {
                  // End of function
                  if (tryCatchCount === 0 && line.includes('await') && functionName !== 'constructor') {
                    analysis.errorHandlingGaps.push({
                      file: path.relative(platformRoot, filePath),
                      line: functionStart,
                      functionName,
                      issue: 'Async function without try/catch for await expressions'
                    });
                  }
                  inFunction = false;
                }
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* dir may not exist */ }
    };

    scanForErrorHandlingGaps(srcDir);

    // Scan for performance bottlenecks (sync file reads in loops, nested loops)
    const scanForBottlenecks = (dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) return;
        const files = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const file of files) {
          if (file.isDirectory() || !file.name.endsWith('.js')) continue;
          
          const filePath = path.join(dirPath, file.name);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            
            // Check for synchronous file reads in hot paths
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (/fs\.readFileSync\s*\(|fs\.readdirSync\s*\(/.test(line) && /for|while|forEach/.test(lines.slice(Math.max(0, i-5), i+1).join(' '))) {
                analysis.performanceBottlenecks.push({
                  file: path.relative(platformRoot, filePath),
                  line: i + 1,
                  issue: 'Synchronous file read/readdir in loop — consider batch reading'
                });
                break;
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* dir may not exist */ }
    };

    scanForBottlenecks(srcDir);

    // Scan for API endpoints without input validation
    const scanForValidationGaps = (dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) return;
        const routeFiles = fs.readdirSync(path.join(dirPath, 'routes'), { withFileTypes: true }).filter(f => f.name.endsWith('.js'));
        
        for (const file of routeFiles) {
          const filePath = path.join(dirPath, 'routes', file.name);
          try {
            const content = fs.readFileSync(filePath, 'utf-8');
            const lines = content.split('\n');
            
            for (let i = 0; i < lines.length; i++) {
              const line = lines[i];
              if (/(router\.post|router\.put|app\.post|app\.put)\s*\(/.test(line)) {
                // Check if next 10 lines contain input validation
                const nextLines = lines.slice(i, i + 10).join('\n');
                if (!/validate|schema|joi|check|assert|typeof/.test(nextLines)) {
                  analysis.apiValidationGaps.push({
                    file: path.relative(platformRoot, filePath),
                    line: i + 1,
                    issue: 'POST/PUT endpoint without apparent input validation'
                  });
                }
              }
            }
          } catch { /* skip */ }
        }
      } catch { /* routes dir may not exist */ }
    };

    scanForValidationGaps(srcDir);

    // Real code analysis
    return analysis;
  }

  async _analyzeCodebaseWithRealAnalysis() {
    // Wrapper that runs the synchronous analysis plus the new async analyses
    const analysis = this._analyzeCodebase();

    try {
      const [untestedFns, unvalidatedApis, asyncUnhandled] = await Promise.all([
        this._findUntestedFunctions(),
        this._findApiEndpointsWithoutValidation(),
        this._findAsyncWithoutErrorHandling()
      ]);

      if (untestedFns.length > 0) analysis.untestedFunctions = untestedFns;
      if (unvalidatedApis.length > 0) analysis.unvalidatedApis = unvalidatedApis;
      if (asyncUnhandled.length > 0) analysis.asyncUnhandled = asyncUnhandled;
    } catch (err) {
      console.warn("[exploration] Code analysis failed:", err?.message);
    }

    return analysis;
  }

  discoverInstalledSkills() {
    const skills = [];
    const seenIds = new Set();

    const scanDir = (dirPath) => {
      try {
        if (!fs.existsSync(dirPath)) return;
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
          if (!entry.isDirectory()) continue;
          if (seenIds.has(entry.name)) continue; // deduplicate

          const skillDir = path.join(dirPath, entry.name);

          // Try skill.json (legacy format)
          const skillJsonPath = path.join(skillDir, "skill.json");
          if (fs.existsSync(skillJsonPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(skillJsonPath, "utf-8"));
              skills.push({ id: entry.name, name: meta.name || entry.name, description: meta.description || "", path: skillDir, version: meta.version || "0.0.0", source: "skill.json" });
              seenIds.add(entry.name);
              continue;
            } catch { /* fall through */ }
          }

          // Try _meta.json + SKILL.md (workspace format)
          const metaJsonPath = path.join(skillDir, "_meta.json");
          const skillMdPath = path.join(skillDir, "SKILL.md");
          if (fs.existsSync(metaJsonPath)) {
            try {
              const meta = JSON.parse(fs.readFileSync(metaJsonPath, "utf-8"));
              let description = meta.description || "";
              // Extract description from SKILL.md frontmatter if available
              if (!description && fs.existsSync(skillMdPath)) {
                const md = fs.readFileSync(skillMdPath, "utf-8");
                const match = md.match(/^description:\s*(.+)$/m);
                if (match) description = match[1].trim();
              }
              skills.push({ id: entry.name, name: meta.slug || entry.name, description, path: skillDir, version: meta.version || "1.0.0", source: "workspace" });
              seenIds.add(entry.name);
            } catch { skills.push({ id: entry.name, name: entry.name, path: skillDir, source: "workspace" }); seenIds.add(entry.name); }
          }
        }
      } catch { /* dir may not exist */ }
    };

    scanDir(SKILL_CATALOG_PATH);
    scanDir(WORKSPACE_SKILL_PATH);

    return skills;
  }

  discoverInstalledTools() {
    const tools = [];
    try {
      const configPath = path.join(OPENCLAW_HOME, "openclaw.json");
      if (!fs.existsSync(configPath)) return tools;
      const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const agents = config.agents || {};
      for (const [agentId, agentDef] of Object.entries(agents)) {
        const agentTools = agentDef.tools || [];
        for (const t of agentTools) {
          tools.push({ agent: agentId, tool: typeof t === "string" ? t : t.name || t.id || "unknown" });
        }
      }
    } catch { /* config may not exist */ }
    return tools;
  }

  async generateExplorationObjective(stats) {
    // Periodically run code analysis (every 5th call)
    this.codebaseAnalysisCalls += 1;
    if (this.codebaseAnalysisCalls % 5 === 0 || !this.codebaseAnalysisCache) {
      try {
        this.codebaseAnalysisCache = await this._analyzeCodebaseWithRealAnalysis();
      } catch (err) {
        console.warn('[explorationEngine] Codebase analysis failed:', err?.message);
        this.codebaseAnalysisCache = null;
      }
    }

    const analysis = this.codebaseAnalysisCache;
    
    // Generate objectives from code analysis if data available
    if (analysis && (analysis.todos.length > 0 || analysis.largeFiles.length > 0 || analysis.testGaps.length > 0 || analysis.errorHandlingGaps.length > 0 || analysis.performanceBottlenecks.length > 0 || analysis.apiValidationGaps.length > 0)) {
      let objective = null;
      let category = null;

      if (analysis.todos.length > 0 && !this.completedExplorations.has('code_todos')) {
        const topTodos = analysis.todos.slice(0, 5);
        const todoList = topTodos.map(t => `  - ${t.file}:${t.line}: ${t.text}`).join('\n');
        objective = `Fix the following TODO/FIXME items in the codebase:\n${todoList}\n\nEach fix should include or update corresponding unit tests. Reference the line numbers and understand the context before making changes.`;
        category = 'code_todos';
      } else if (analysis.errorHandlingGaps.length > 0 && !this.completedExplorations.has('error_handling')) {
        const gap = analysis.errorHandlingGaps[0];
        objective = `Improve error handling in ${gap.file}:${gap.line} (function: ${gap.functionName}). Issue: ${gap.issue}. Wrap async/await calls in try/catch blocks with proper error logging. Log errors with context (file, line, operation). Do not use bare catch blocks. Update any corresponding tests to verify error paths.`;
        category = 'error_handling';
      } else if (analysis.performanceBottlenecks.length > 0 && !this.completedExplorations.has('performance_fix')) {
        const bottleneck = analysis.performanceBottlenecks[0];
        objective = `Fix performance bottleneck in ${bottleneck.file}:${bottleneck.line}. Issue: ${bottleneck.issue}. Optimize by refactoring to use batch operations or async file reads instead of synchronous loops. Measure improvement with timing benchmarks before/after. Ensure no functionality is broken.`;
        category = 'performance_fix';
      } else if (analysis.apiValidationGaps.length > 0 && !this.completedExplorations.has('api_validation')) {
        const gap = analysis.apiValidationGaps[0];
        objective = `Add input validation to ${gap.file}:${gap.line}. Issue: ${gap.issue}. Implement schema validation for request body/params. Check bounds, types, and required fields. Return 400 Bad Request with clear error messages for invalid inputs. Add tests to verify validation rejection paths.`;
        category = 'api_validation';
      } else if (analysis.largeFiles.length > 0 && !this.completedExplorations.has('refactoring')) {
        const largeFile = analysis.largeFiles[0];
        let functionNames = [];
        try {
          const content = fs.readFileSync(path.join(platformRoot, largeFile.file), 'utf-8');
          const funcMatches = content.matchAll(/^(?:export\s+)?(?:async\s+)?function\s+(\w+)|^(?:export\s+)?class\s+(\w+)/gm);
          for (const m of funcMatches) {
            functionNames.push(m[1] || m[2]);
          }
        } catch { /* skip */ }
        const funcList = functionNames.slice(0, 5).join(', ') || 'key functions';
        objective = `Refactor ${largeFile.file} (${largeFile.lines} lines) by extracting helper functions. Focus on: ${funcList}. Split into smaller focused modules or extract utility functions. Do not change external API contracts. Add tests for any new utility functions.`;
        category = 'refactoring';
      } else if (analysis.testGaps.length > 0 && !this.completedExplorations.has('test_coverage')) {
        const gapFile = analysis.testGaps[0];
        const baseName = path.basename(gapFile.srcFile, '.js');
        let exports = [];
        try {
          const content = fs.readFileSync(path.join(platformRoot, gapFile.srcFile), 'utf-8');
          const exportMatches = content.matchAll(/export\s+(?:async\s+)?(?:function|class)\s+(\w+)|export\s+(?:const|let)\s+(\w+)/g);
          for (const m of exportMatches) {
            exports.push(m[1] || m[2]);
          }
        } catch { /* skip */ }
        const exportList = exports.slice(0, 5).join(', ') || 'main exports';
        objective = `Write unit tests for ${gapFile.srcFile}. Create tests/unit/${baseName}.test.js using node:test. Cover these exports: ${exportList}. Focus on error paths, edge cases, and valid inputs. Aim for >80% line coverage.`;
        category = 'test_coverage';
      } else if (analysis.untestedFunctions?.length > 0 && !this.completedExplorations.has('untested_functions') && Math.random() < 0.3) {
        const item = analysis.untestedFunctions[Math.floor(Math.random() * analysis.untestedFunctions.length)];
        const fns = item.untestedFunctions.slice(0, 3).join(", ");
        objective = `Add unit tests for untested exports in ${item.file}: specifically test ${fns}. Each function should have at least 2 test cases covering normal operation and edge cases. Tests go in tests/unit/ following the existing node:test pattern.`;
        category = 'untested_functions';
      } else if (analysis.unvalidatedApis?.length > 0 && !this.completedExplorations.has('unvalidated_apis') && Math.random() < 0.3) {
        const item = analysis.unvalidatedApis[Math.floor(Math.random() * analysis.unvalidatedApis.length)];
        const routes = item.unvalidatedEndpoints.map(e => `${e.method} ${e.route} (line ${e.line})`).join(", ");
        objective = `Add input validation to unprotected API endpoints in ${item.file}: ${routes}. Use the existing validateDispatchBody pattern from validation.js. Validate required fields, types, and sanitize string inputs. Return 400 with clear error messages for invalid input.`;
        category = 'unvalidated_apis';
      } else if (analysis.asyncUnhandled?.length > 0 && !this.completedExplorations.has('async_unhandled') && Math.random() < 0.25) {
        const item = analysis.asyncUnhandled[Math.floor(Math.random() * analysis.asyncUnhandled.length)];
        const fns = item.functions.map(f => `${f.name}() at line ${f.line}`).join(", ");
        objective = `Add error handling to async functions in ${item.file} that currently have no try/catch: ${fns}. Wrap await calls in try/catch, log errors with context (function name, relevant IDs), emit appropriate error events via emitEvent if available, and ensure callers get meaningful error objects rather than unhandled rejections.`;
        category = 'async_unhandled';
      }

      if (objective && category) {
        this.completedExplorations.add(category);
        return {
          category,
          objective: this._enhanceObjectiveWithAiTechContext(objective),
          weight: 0.72, // Boost for analysis-driven objectives
          isExternal: true,
          fromCodeAnalysis: true
        };
      }
    }

    // Fallback to template-based objectives
    const eligible = EXTERNAL_OBJECTIVE_TEMPLATES.filter(t => !this.completedExplorations.has(t.category));
    if (eligible.length === 0) {
      this.completedExplorations.clear();
      return this.generateExplorationObjective(stats);
    }

    // Use specialization engine to bias category selection if available
    let selectedCategory = null;
    if (this.specializationEngine) {
      const availableCategories = eligible.map(t => t.category);
      selectedCategory = this.specializationEngine.getBiasedCategory(availableCategories);
    } else {
      // Fallback to weighted random selection
      const weighted = eligible.map(t => {
        let adjustedWeight = t.weight;
        if (t.category === "security_audit" && stats.completed < 5) adjustedWeight *= 1.5;
        if (t.category === "resilience" && stats.avgLatency > 30000) adjustedWeight *= 1.3;
        if (t.category === "code_quality" && stats.completed > 20) adjustedWeight *= 1.2;
        return { ...t, adjustedWeight };
      });

      weighted.sort((a, b) => b.adjustedWeight - a.adjustedWeight);
      selectedCategory = weighted[0].category;
    }

    const selected = eligible.find(t => t.category === selectedCategory) || eligible[0];
    this.completedExplorations.add(selected.category);

    return {
      category: selected.category,
      objective: this._enhanceObjectiveWithAiTechContext(selected.generator()),
      weight: selected.weight,
      isExternal: true,
      fromCodeAnalysis: false
    };
  }

  generateSkillDiscoveryObjective() {
    const skills = this.discoverInstalledSkills();
    const tools = this.discoverInstalledTools();

    const skillSummary = skills.length > 0
      ? skills.map(s => `  - ${s.name}: ${s.description || "(no description)"}`).join("\n")
      : "  (none installed)";

    const toolSummary = tools.length > 0
      ? tools.map(t => `  - ${t.agent}: ${t.tool}`).join("\n")
      : "  (none configured in openclaw.json — agents use built-in web_search, read_file, write_file, execute_code)";

    const skillObjective = `Audit the OpenClaw skill and tool ecosystem for the swarm platform.

CURRENTLY INSTALLED SKILLS (${skills.length}):
${skillSummary}

CONFIGURED AGENT TOOLS (${tools.length}):
${toolSummary}

Your task:
1. Evaluate whether the installed skills are actually being used by agents (check if any skill behaviors appear in recent task outputs)
2. Identify the top 3 skill/tool gaps that would most improve autonomous task completion
3. For skills already installed (e.g., ddg-search), write example usage patterns that agents should know about
4. Propose 2-3 new skill ideas specific to the swarm platform's research/build/critic/integrator pipeline
5. Design a "skill-aware prompt injection" strategy: how should the swarm platform proactively include relevant skill instructions in agent prompts?

Be specific and actionable. Reference the actual skill names and capabilities when making recommendations.`;

    return {
      category: "skill_discovery",
      objective: this._enhanceObjectiveWithAiTechContext(skillObjective),
      weight: 0.75,
      isExternal: true
    };
  }

  weighObjectives(selfImprovementObj, explorationObj, stats) {
    // Use externally computed weights if provided (from ROI or lesson-based feedback loop)
    // If selfWeight/exploreWeight are explicitly set (sum != 1.0 from defaults), they came from ROI boost
    // In that case, don't apply additional boosts as they would override the ROI signal
    const selfWeight = stats?.selfWeight ?? 0.6;
    const exploreWeight = stats?.exploreWeight ?? 0.4;
    const hasExplicitWeights = stats?.selfWeight !== undefined || stats?.exploreWeight !== undefined;

    let adjustedExploreWeight = exploreWeight;
    let adjustedSelfWeight = selfWeight;

    // Only apply additional boosts if weights were NOT explicitly set by ROI logic
    if (!hasExplicitWeights) {
      const roundNumber = stats?.completed || 0;
      const exploreBoost = Math.min(0.2, roundNumber * 0.02);

      // Boost weight if exploration objective was generated from code analysis
      adjustedExploreWeight = exploreWeight + exploreBoost;
      if (explorationObj.fromCodeAnalysis) {
        adjustedExploreWeight += 0.15;
      }
      adjustedSelfWeight = selfWeight - (adjustedExploreWeight - (exploreWeight + exploreBoost));
    }

    // High-priority exploration overrides weights
    if (explorationObj.weight > 0.9) {
      return { selected: explorationObj, reason: `High-priority exploration: ${explorationObj.category}` };
    }

    // Use weighted random selection based on computed weights
    if (Math.random() < adjustedExploreWeight) {
      return { selected: explorationObj, reason: `Exploration selected. Weight: ${adjustedExploreWeight.toFixed(2)}${explorationObj.fromCodeAnalysis ? ' (code-analysis boosted)' : ''}` };
    }

    return { selected: selfImprovementObj, reason: `Self-improvement priority. Weight: ${adjustedSelfWeight.toFixed(2)}` };
  }
}
