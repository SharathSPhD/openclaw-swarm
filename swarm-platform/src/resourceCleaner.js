import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

export class ResourceCleaner {
  constructor({ onWarning } = {}) {
    this.onWarning = onWarning || console.warn;
    this.timer = null;
    this.lastCleanup = null;
    this.lastStatus = {};
  }

  start() {
    this.timer = setInterval(() => this.cleanup(), CLEANUP_INTERVAL_MS);
    this.cleanup();
    console.log("[resourceCleaner] Started — running every 10 minutes");
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async cleanup() {
    const results = { ts: new Date().toISOString(), docker: null, disk: null, gpu: null };

    // 1. Docker container prune
    try {
      const { stdout } = await execFileAsync("docker", ["container", "prune", "-f"], { timeout: 15000 });
      const match = stdout.match(/Total reclaimed space:\s*(.+)/);
      results.docker = { pruned: true, reclaimed: match ? match[1].trim() : "0B" };
      console.log(`[resourceCleaner] Docker pruned: ${results.docker.reclaimed}`);
    } catch (err) {
      results.docker = { pruned: false, error: err?.message || "unknown" };
    }

    // 2. Disk usage check
    try {
      const { stdout } = await execFileAsync("df", ["-h", "/"], { timeout: 5000 });
      const lines = stdout.trim().split("\n");
      if (lines.length >= 2) {
        const parts = lines[1].split(/\s+/);
        const usePercent = parseInt(parts[4], 10);
        results.disk = { usePercent, size: parts[1], used: parts[2], available: parts[3] };
        if (usePercent > 80) {
          this.onWarning(`[resourceCleaner] Disk usage high: ${usePercent}%`);
        }
      }
    } catch (err) {
      results.disk = { error: err?.message || "unknown" };
    }

    // 3. GPU memory check
    try {
      const { stdout } = await execFileAsync("nvidia-smi", [
        "--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu",
        "--format=csv,noheader,nounits"
      ], { timeout: 5000 });
      const parts = stdout.trim().split(",").map(v => v.trim());
      if (parts.length >= 4) {
        const utilization = parseInt(parts[0], 10);
        const memUsed = parseInt(parts[1], 10);
        const memTotal = parseInt(parts[2], 10);
        const temp = parseInt(parts[3], 10);
        results.gpu = { utilization, memUsed, memTotal, temp };
        if (utilization > 90) {
          this.onWarning(`[resourceCleaner] GPU utilization high: ${utilization}%`);
        }
        if (temp > 80) {
          this.onWarning(`[resourceCleaner] GPU temperature high: ${temp}C`);
        }
      }
    } catch (err) {
      results.gpu = { error: err?.message || "unknown" };
    }

    this.lastCleanup = Date.now();
    this.lastStatus = results;
    return results;
  }

  getStatus() {
    return {
      lastCleanup: this.lastCleanup ? new Date(this.lastCleanup).toISOString() : null,
      intervalMs: CLEANUP_INTERVAL_MS,
      ...this.lastStatus
    };
  }
}
