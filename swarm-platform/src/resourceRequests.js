import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const defaultDataDir = path.resolve(__dirname, "..", "data");

export class ResourceRequests {
  constructor({ dataDir = defaultDataDir } = {}) {
    this.dataDir = dataDir;
    this.requestsFile = path.join(dataDir, "resource_requests.json");
    this._ensureFile();
  }

  _ensureFile() {
    if (!fs.existsSync(this.requestsFile)) {
      fs.writeFileSync(this.requestsFile, JSON.stringify({ requests: [] }, null, 2), "utf8");
    }
  }

  _read() {
    try {
      const content = fs.readFileSync(this.requestsFile, "utf8");
      const data = JSON.parse(content);
      return data.requests || [];
    } catch {
      return [];
    }
  }

  _write(requests) {
    // Cap at 200 requests
    const capped = requests.slice(Math.max(0, requests.length - 200));
    fs.writeFileSync(this.requestsFile, JSON.stringify({ requests: capped }, null, 2), "utf8");
  }

  requestResource({ type, name, reason, requestedBy, round }) {
    const requests = this._read();
    
    // Deduplicate: if same name+status=pending exists, skip
    const existing = requests.find(r => r.name === name && r.status === "pending");
    if (existing) {
      return existing;
    }

    const request = {
      id: randomUUID(),
      type,
      name,
      reason,
      requestedBy,
      round: round || null,
      status: "pending",
      ts: Date.now(),
      resolvedAt: null,
      resolvedBy: null,
      detected: false
    };

    requests.push(request);
    this._write(requests);
    return request;
  }

  approve(id) {
    const requests = this._read();
    const request = requests.find(r => r.id === id);
    if (!request) return null;

    request.status = "approved";
    request.resolvedAt = Date.now();
    request.resolvedBy = "admin";
    this._write(requests);
    return request;
  }

  reject(id) {
    const requests = this._read();
    const request = requests.find(r => r.id === id);
    if (!request) return null;

    request.status = "rejected";
    request.resolvedAt = Date.now();
    request.resolvedBy = "admin";
    this._write(requests);
    return request;
  }

  getAll() {
    const requests = this._read();
    return requests.slice().sort((a, b) => b.ts - a.ts);
  }

  getPending() {
    const requests = this._read();
    return requests.filter(r => r.status === "pending").sort((a, b) => b.ts - a.ts);
  }

  checkEnvDetection() {
    const requests = this._read();
    const detected = [];

    for (const request of requests) {
      if (request.type === "env_token" && request.status === "approved" && !request.detected) {
        if (process.env[request.name]) {
          request.detected = true;
          detected.push(request);
        }
      }
    }

    if (detected.length > 0) {
      this._write(requests);
    }

    return detected;
  }
}
