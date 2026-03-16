import { execFileSync } from "node:child_process";
import path from "node:path";
import fs from "node:fs";

const PROJECT_ROOT = path.resolve(import.meta.dirname, "..", "..");

export class WorktreeManager {
  constructor({ projectRoot = PROJECT_ROOT, telegramBot, chatId } = {}) {
    this.projectRoot = projectRoot;
    this.worktreeBase = path.join(projectRoot, "worktrees");
    this.telegramBot = telegramBot;
    this.chatId = chatId;

    if (!fs.existsSync(this.worktreeBase)) {
      fs.mkdirSync(this.worktreeBase, { recursive: true });
    }
  }

  _git(...args) {
    return execFileSync("git", args, {
      cwd: this.projectRoot,
      encoding: "utf-8",
      timeout: 30000
    }).trim();
  }

  branchName(teamId, objectiveId) {
    const short = objectiveId.replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
    return `${teamId}/${short}`;
  }

  worktreePath(teamId) {
    return path.join(this.worktreeBase, teamId);
  }

  setupWorktree(teamId, objectiveId) {
    const branch = this.branchName(teamId, objectiveId);
    const wtPath = this.worktreePath(teamId);

    // Always prune stale worktree registrations first
    try { this._git("worktree", "prune"); } catch { /* ignore */ }

    // Clean up existing worktree (path or stale registration)
    this.cleanupWorktree(teamId);

    try { this._git("branch", "-D", branch); } catch { /* branch may not exist */ }

    this._git("branch", branch, "main");
    this._git("worktree", "add", "--force", wtPath, branch);

    return { branch, path: wtPath };
  }

  cleanupWorktree(teamId) {
    const wtPath = this.worktreePath(teamId);

    if (fs.existsSync(wtPath)) {
      try {
        this._git("worktree", "remove", "--force", wtPath);
      } catch {
        try { fs.rmSync(wtPath, { recursive: true, force: true }); } catch { /* best-effort */ }
      }
    }

    // Always prune to clear stale registrations even when path is missing
    try { this._git("worktree", "prune"); } catch { /* ignore */ }
  }

  mergeToMain(teamId, objectiveId) {
    const branch = this.branchName(teamId, objectiveId);
    this._git("checkout", "main");
    return this._git("merge", "--no-ff", "-m", `Merge ${branch} into main`, branch);
  }

  pushToRemote() {
    return this._git("push", "origin", "main");
  }

  detectServerChanges() {
    try {
      // Guard: check we have at least 2 commits before diffing main~1
      const commitCount = this._git("rev-list", "--count", "main").trim();
      if (parseInt(commitCount, 10) < 2) return [];
      const diff = this._git("diff", "--name-only", "main~1", "main", "--", "swarm-platform/src/");
      return diff.split("\n").filter(Boolean);
    } catch {
      return [];
    }
  }

  async mergeAndPush(teamId, objectiveId) {
    const mergeResult = this.mergeToMain(teamId, objectiveId);
    const changedFiles = this.detectServerChanges();
    const pushed = this.pushToRemote();

    this.cleanupWorktree(teamId);
    try {
      const branch = this.branchName(teamId, objectiveId);
      this._git("branch", "-d", branch);
    } catch { /* ignore */ }

    const needsRestart = changedFiles.some(f => f.startsWith("swarm-platform/src/"));

    return { mergeResult, pushed, changedFiles, needsRestart };
  }

  listWorktrees() {
    try {
      const out = this._git("worktree", "list", "--porcelain");
      const trees = [];
      let current = {};
      for (const line of out.split("\n")) {
        if (line.startsWith("worktree ")) {
          if (current.path) trees.push(current);
          current = { path: line.slice(9) };
        } else if (line.startsWith("branch ")) {
          current.branch = line.slice(7);
        } else if (line === "bare") {
          current.bare = true;
        }
      }
      if (current.path) trees.push(current);
      return trees.filter(t => !t.bare && t.path !== this.projectRoot);
    } catch {
      return [];
    }
  }

  detectAndCommitMainChanges(objectiveId, description) {
    try {
      // Check for any unstaged changes in the main repo
      const statusOut = this._git("status", "--porcelain");
      if (!statusOut.trim()) return { changedFiles: [], committed: false };

      const changedFiles = statusOut
        .split("\n")
        .filter(Boolean)
        .map(line => line.trim().replace(/^[^\s]+\s+/, ""))
        .filter(f => f.startsWith("swarm-platform/"))
        // Exclude runtime data files — only commit source code and config
        .filter(f => !f.startsWith("swarm-platform/data/") && !f.endsWith(".jsonl"));

      if (changedFiles.length === 0) return { changedFiles: [], committed: false };

      // Stage only source files, not data directory
      this._git("add", "swarm-platform/src/", "swarm-platform/ui/src/", "swarm-platform/tests/");
      const msg = `feat: gamma implements ${description.slice(0, 80)} [${objectiveId.slice(0, 8)}]`;
      this._git("commit", "-m", msg);

      console.log(`[worktree] Committed ${changedFiles.length} files for gamma: ${msg}`);
      return { changedFiles, committed: true };
    } catch (err) {
      console.warn("[worktree] detectAndCommitMainChanges failed:", err?.message);
      return { changedFiles: [], committed: false, error: err?.message };
    }
  }

  safePushToRemote() {
    try {
      return this._git("push", "origin", "main");
    } catch (err) {
      console.warn("[worktree] push failed:", err?.message);
      return null;
    }
  }
}
