import { execSync } from "node:child_process";

function toNum(value) {
  const parsed = Number(String(value || "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function parseCsvRows(output) {
  return String(output || "")
    .trim()
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split(",").map((cell) => cell.trim()));
}

function parseGpuProcesses() {
  try {
    const cmd = "nvidia-smi --query-compute-apps=gpu_uuid,pid,process_name,used_memory --format=csv,noheader,nounits";
    const output = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const rows = parseCsvRows(output);
    return rows.map((row) => ({
      gpu: row[0] || "unknown",
      pid: toNum(row[1]),
      process: row[2] || "unknown",
      usedMb: toNum(row[3])
    }));
  } catch {
    return [];
  }
}

function parseOllamaPs() {
  try {
    const output = execSync("ollama ps", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    const lines = String(output || "")
      .trim()
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);

    if (lines.length <= 1) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i += 1) {
      const parts = lines[i].split(/\s{2,}/).filter(Boolean);
      if (!parts.length) continue;
      rows.push({
        model: parts[0] || "unknown",
        processor: parts[3] || "unknown",
        context: parts[4] || "unknown",
        until: parts[5] || "unknown"
      });
    }
    return rows;
  } catch {
    return [];
  }
}

function parseOllamaRunProcesses() {
  try {
    const output = execSync("ps -eo pid,args", { stdio: ["ignore", "pipe", "ignore"] }).toString();
    return output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => /ollama\s+run\s+/i.test(line))
      .map((line) => {
        const firstSpace = line.indexOf(" ");
        const pid = toNum(firstSpace > -1 ? line.slice(0, firstSpace) : "");
        const cmd = firstSpace > -1 ? line.slice(firstSpace + 1) : line;
        return { pid, cmd };
      });
  } catch {
    return [];
  }
}

function parseNvidiaSmi() {
  try {
    const cmd = "nvidia-smi --query-gpu=index,memory.total,memory.used,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits";
    const output = execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    if (!output) return null;

    const rows = output.split("\n").map((line) => {
      const [index, total, used, util, temp, power] = line.split(",").map((v) => v.trim());
      const totalMb = toNum(total);
      const usedMb = toNum(used);
      const utilPct = toNum(util);
      const tempC = toNum(temp);
      const powerW = toNum(power);
      return {
        index: toNum(index),
        totalMb,
        usedMb,
        utilPct,
        tempC,
        powerW,
        usedPct: totalMb && usedMb !== null ? Math.round((usedMb / totalMb) * 100) : null
      };
    });

    const validTotals = rows.map((r) => r.totalMb).filter((v) => v !== null);
    const validUsed = rows.map((r) => r.usedMb).filter((v) => v !== null);
    const validUtil = rows.map((r) => r.utilPct).filter((v) => v !== null);

    const totalMb = validTotals.reduce((sum, v) => sum + v, 0);
    const usedMb = validUsed.reduce((sum, v) => sum + v, 0);
    const utilPct = validUtil.length ? Math.round(validUtil.reduce((sum, v) => sum + v, 0) / validUtil.length) : 0;
    const usedPct = totalMb ? Math.round((usedMb / totalMb) * 100) : null;
    const processes = parseGpuProcesses();
    const ollamaRuntime = parseOllamaPs();
    const ollamaRunProcesses = parseOllamaRunProcesses();
    const localGpuBacked =
      ollamaRuntime.some((r) => String(r.processor || "").toLowerCase().includes("gpu")) ||
      ollamaRunProcesses.length > 0;

    return {
      available: true,
      totalMb: totalMb || null,
      usedMb: usedMb || null,
      usedPct,
      utilPct,
      gpus: rows.length,
      devices: rows,
      processes,
      ollamaRuntime,
      ollamaRunProcesses,
      localGpuBacked
    };
  } catch {
    return null;
  }
}

export function readSystemSnapshot() {
  const gpu = parseNvidiaSmi();
  return {
    ts: new Date().toISOString(),
    gpu: gpu ?? { available: false }
  };
}

export function classifyLoad(snapshot, cfg) {
  const usedPct = snapshot.gpu?.usedPct ?? 0;
  if (!snapshot.gpu?.available) return "unknown";
  if (usedPct >= cfg.gpuCritPct) return "critical";
  if (usedPct >= (cfg.gpuEmergencyPct || 85)) return "emergency";
  if (usedPct >= cfg.gpuWarnPct) return "high";
  if (usedPct >= Math.max(50, cfg.gpuWarnPct - 15)) return "elevated";
  return "normal";
}
