import express from "express";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "../..");
const latencyFile = path.join(root, "data", "model_latency.json");

/**
 * Create metrics router with dependencies injected
 * @param {Object} deps - Dependencies object
 * @param {Store} deps.store - Event store
 * @param {QueueManager} deps.queueManager - Queue manager
 * @param {Object} deps.modelCatalog - Model catalog functions
 * @returns {express.Router} Express router
 */
export function createMetricsRouter({ store, queueManager, modelCatalog }) {
  const router = express.Router();

  /**
   * GET /api/metrics/gpu
   * Returns GPU utilization and running models info
   */
  router.get("/gpu", (_req, res) => {
    const result = {
      gpu: null,
      runningModels: [],
      ollamaOk: false
    };

    // Try to get GPU stats from nvidia-smi
    // Safe: no user input, hardcoded command
    try {
      const output = execSync(
        'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
        { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
      ).toString().trim();

      const parts = output.split(',').map((v) => v.trim());
      if (parts.length >= 3) {
        const utilization = parseInt(parts[0], 10);
        const memoryUsed = parseInt(parts[1], 10);
        const memoryTotal = parseInt(parts[2], 10);

        if (Number.isFinite(utilization) && Number.isFinite(memoryUsed) && Number.isFinite(memoryTotal)) {
          result.gpu = {
            utilization,
            memoryUsed,
            memoryTotal
          };
        }
      }
    } catch (_err) {
      // nvidia-smi not available or failed, gpu remains null
    }

    // Try to get running models from Ollama
    // Safe: OLLAMA_URL is from env config, hardcoded curl command
    try {
      const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
      const response = execSync(
        `curl -s ${ollamaUrl}/api/ps`,
        { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
      ).toString().trim();

      if (response) {
        const data = JSON.parse(response);
        if (data.models && Array.isArray(data.models)) {
          result.runningModels = data.models.map((m) => m.name || m.model).filter(Boolean);
          result.ollamaOk = true;
        }
      }
    } catch (_err) {
      // Ollama not available, ollamaOk remains false
    }

    res.json(result);
  });

  /**
   * GET /api/metrics/latency
   * Returns model latency stats and recent performance metrics
   */
  router.get("/latency", (_req, res) => {
    const result = {
      byModel: {},
      recentAvg: 0,
      p95: 0,
      sampleCount: 0
    };

    // Read pre-computed model latency data from disk
    try {
      const content = fs.readFileSync(latencyFile, "utf8");
      const data = JSON.parse(content);
      if (data.models && typeof data.models === "object") {
        for (const [modelId, modelData] of Object.entries(data.models)) {
          if (modelData.avgMs || modelData.p50Ms) {
            result.byModel[modelId] = modelData.avgMs || modelData.p50Ms;
          }
        }
      }
    } catch (_err) {
      // File not found or parse error, byModel remains {}
    }

    // Compute real-time latency from recent events
    try {
      const recentEvents = store.getEvents(500);
      const durations = [];

      for (const event of recentEvents) {
        if (event.type === "task.completed" && event.payload?.durationMs) {
          durations.push(Number(event.payload.durationMs));
        }
      }

      if (durations.length > 0) {
        result.sampleCount = durations.length;

        // Calculate average
        const sum = durations.reduce((a, b) => a + b, 0);
        result.recentAvg = Math.round(sum / durations.length);

        // Calculate p95 (95th percentile)
        const sorted = durations.sort((a, b) => a - b);
        const p95Index = Math.ceil(sorted.length * 0.95) - 1;
        result.p95 = sorted[Math.max(0, p95Index)] || 0;
      }
    } catch (_err) {
      // Error processing events, use defaults
    }

    res.json(result);
  });

  /**
   * GET /api/metrics/throughput
   * Returns objective throughput and success metrics
   */
  router.get("/throughput", (_req, res) => {
    const result = {
      perHour: 0,
      perMinute: 0,
      successRate: 0,
      queueDepth: queueManager?.depth || 0
    };

    try {
      const now = Date.now();
      const oneHourAgo = now - 60 * 60 * 1000;
      const fiveMinutesAgo = now - 5 * 60 * 1000;

      const allEvents = store.getEvents(store.maxEvents);

      // Count objectives in last hour
      const lastHourObjectives = allEvents.filter((e) => {
        const eventTime = new Date(e.ts).getTime();
        return (
          eventTime >= oneHourAgo &&
          (e.type === "objective.created" || e.type === "task.submitted")
        );
      });

      result.perHour = lastHourObjectives.length;

      // Count objectives in last 5 minutes for per-minute
      const lastFiveMinObjectives = allEvents.filter((e) => {
        const eventTime = new Date(e.ts).getTime();
        return (
          eventTime >= fiveMinutesAgo &&
          (e.type === "objective.created" || e.type === "task.submitted")
        );
      });

      result.perMinute = Number((lastFiveMinObjectives.length / 5).toFixed(2));

      // Calculate success rate from last 100 events
      const recentEvents = allEvents.slice(-100);
      const completedCount = recentEvents.filter(
        (e) => e.type === "task.completed" || e.type === "objective.created"
      ).length;
      const failedCount = recentEvents.filter(
        (e) => e.type === "task.failed"
      ).length;

      const totalRelevant = completedCount + failedCount;
      if (totalRelevant > 0) {
        result.successRate = Number((completedCount / totalRelevant).toFixed(3));
      }
    } catch (_err) {
      // Error processing events, use defaults
    }

    res.json(result);
  });

  /**
   * GET /api/metrics/summary
   * Returns all metrics in a single response
   */
  router.get("/summary", async (_req, res) => {
    try {
      // Collect all metrics concurrently
      const [gpuRes, latencyRes, throughputRes] = await Promise.all([
        new Promise((resolve) => {
          // Simulate GET /gpu
          const result = {
            gpu: null,
            runningModels: [],
            ollamaOk: false
          };

          try {
            const output = execSync(
              'nvidia-smi --query-gpu=utilization.gpu,memory.used,memory.total --format=csv,noheader,nounits',
              { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
            ).toString().trim();

            const parts = output.split(',').map((v) => v.trim());
            if (parts.length >= 3) {
              const utilization = parseInt(parts[0], 10);
              const memoryUsed = parseInt(parts[1], 10);
              const memoryTotal = parseInt(parts[2], 10);

              if (Number.isFinite(utilization) && Number.isFinite(memoryUsed) && Number.isFinite(memoryTotal)) {
                result.gpu = {
                  utilization,
                  memoryUsed,
                  memoryTotal
                };
              }
            }
          } catch (_err) {
            // nvidia-smi not available
          }

          try {
            const ollamaUrl = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
            const response = execSync(
              `curl -s ${ollamaUrl}/api/ps`,
              { stdio: ["ignore", "pipe", "ignore"], timeout: 5000 }
            ).toString().trim();

            if (response) {
              const data = JSON.parse(response);
              if (data.models && Array.isArray(data.models)) {
                result.runningModels = data.models.map((m) => m.name || m.model).filter(Boolean);
                result.ollamaOk = true;
              }
            }
          } catch (_err) {
            // Ollama not available
          }

          resolve(result);
        }),

        new Promise((resolve) => {
          // Simulate GET /latency
          const result = {
            byModel: {},
            recentAvg: 0,
            p95: 0,
            sampleCount: 0
          };

          try {
            const content = fs.readFileSync(latencyFile, "utf8");
            const data = JSON.parse(content);
            if (data.models && typeof data.models === "object") {
              for (const [modelId, modelData] of Object.entries(data.models)) {
                if (modelData.avgMs || modelData.p50Ms) {
                  result.byModel[modelId] = modelData.avgMs || modelData.p50Ms;
                }
              }
            }
          } catch (_err) {
            // File not found or parse error
          }

          try {
            const recentEvents = store.getEvents(500);
            const durations = [];

            for (const event of recentEvents) {
              if (event.type === "task.completed" && event.payload?.durationMs) {
                durations.push(Number(event.payload.durationMs));
              }
            }

            if (durations.length > 0) {
              result.sampleCount = durations.length;
              const sum = durations.reduce((a, b) => a + b, 0);
              result.recentAvg = Math.round(sum / durations.length);
              const sorted = durations.sort((a, b) => a - b);
              const p95Index = Math.ceil(sorted.length * 0.95) - 1;
              result.p95 = sorted[Math.max(0, p95Index)] || 0;
            }
          } catch (_err) {
            // Error processing events
          }

          resolve(result);
        }),

        new Promise((resolve) => {
          // Simulate GET /throughput
          const result = {
            perHour: 0,
            perMinute: 0,
            successRate: 0,
            queueDepth: queueManager?.depth || 0
          };

          try {
            const now = Date.now();
            const oneHourAgo = now - 60 * 60 * 1000;
            const fiveMinutesAgo = now - 5 * 60 * 1000;

            const allEvents = store.getEvents(store.maxEvents);

            const lastHourObjectives = allEvents.filter((e) => {
              const eventTime = new Date(e.ts).getTime();
              return (
                eventTime >= oneHourAgo &&
                (e.type === "objective.created" || e.type === "task.submitted")
              );
            });

            result.perHour = lastHourObjectives.length;

            const lastFiveMinObjectives = allEvents.filter((e) => {
              const eventTime = new Date(e.ts).getTime();
              return (
                eventTime >= fiveMinutesAgo &&
                (e.type === "objective.created" || e.type === "task.submitted")
              );
            });

            result.perMinute = Number((lastFiveMinObjectives.length / 5).toFixed(2));

            const recentEvents = allEvents.slice(-100);
            const completedCount = recentEvents.filter(
              (e) => e.type === "task.completed" || e.type === "objective.created"
            ).length;
            const failedCount = recentEvents.filter(
              (e) => e.type === "task.failed"
            ).length;

            const totalRelevant = completedCount + failedCount;
            if (totalRelevant > 0) {
              result.successRate = Number((completedCount / totalRelevant).toFixed(3));
            }
          } catch (_err) {
            // Error processing events
          }

          resolve(result);
        })
      ]);

      res.json({
        gpu: gpuRes.gpu,
        runningModels: gpuRes.runningModels,
        ollamaOk: gpuRes.ollamaOk,
        latency: {
          byModel: latencyRes.byModel,
          recentAvg: latencyRes.recentAvg,
          p95: latencyRes.p95,
          sampleCount: latencyRes.sampleCount
        },
        throughput: {
          perHour: throughputRes.perHour,
          perMinute: throughputRes.perMinute,
          successRate: throughputRes.successRate,
          queueDepth: throughputRes.queueDepth
        }
      });
    } catch (err) {
      res.status(500).json({ error: "Failed to collect metrics", message: err.message });
    }
  });

  return router;
}
