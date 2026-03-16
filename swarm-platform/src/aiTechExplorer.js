/**
 * AI Tech Explorer
 *
 * Maintains a catalog of AI tools and technologies the system knows about.
 * Used by ExplorationEngine to inform program lead prompts with available tools.
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_CATALOG = [
  {
    id: "vllm",
    name: "vLLM",
    category: "inference-engines",
    description: "High-throughput LLM serving with PagedAttention",
    integrationValue: 9,
    explorationStatus: "integrated",
    tags: ["serving", "gpu", "openai-compatible"],
    notes: "Currently running on port 8000 for Qwen3-14B-NVFP4"
  },
  {
    id: "ollama",
    name: "Ollama",
    category: "inference-engines",
    description: "Local LLM serving with OpenAI-compatible API",
    integrationValue: 9,
    explorationStatus: "integrated",
    tags: ["serving", "local", "openai-compatible"],
    notes: "Multi-model support with model discovery"
  },
  {
    id: "langchain",
    name: "LangChain",
    category: "orchestration",
    description: "LLM application framework",
    integrationValue: 7,
    explorationStatus: "known",
    tags: ["framework", "chains", "agents"],
    notes: "Popular for building LLM applications"
  },
  {
    id: "llamaindex",
    name: "LlamaIndex",
    category: "orchestration",
    description: "Data framework for LLM apps",
    integrationValue: 7,
    explorationStatus: "known",
    tags: ["rag", "indexing", "retrieval"],
    notes: "Designed for RAG pipelines"
  },
  {
    id: "chromadb",
    name: "ChromaDB",
    category: "vector-dbs",
    description: "Embeddings-based vector database",
    integrationValue: 8,
    explorationStatus: "known",
    tags: ["vector-db", "embeddings", "python"],
    notes: "Easy to use with Hugging Face embeddings"
  },
  {
    id: "faiss",
    name: "FAISS",
    category: "vector-dbs",
    description: "Facebook AI similarity search",
    integrationValue: 7,
    explorationStatus: "known",
    tags: ["vector-db", "search", "similarity"],
    notes: "High-performance similarity search"
  },
  {
    id: "huggingface",
    name: "HuggingFace Hub",
    category: "data-pipeline",
    description: "Model and dataset repository",
    integrationValue: 8,
    explorationStatus: "known",
    tags: ["models", "datasets", "hub"],
    notes: "Central hub for open-source ML models"
  },
  {
    id: "modal",
    name: "Modal",
    category: "data-pipeline",
    description: "Serverless GPU compute platform",
    integrationValue: 6,
    explorationStatus: "exploring",
    tags: ["serverless", "gpu", "cloud"],
    notes: "Distributed task execution with GPU support"
  },
  {
    id: "dspy",
    name: "DSPy",
    category: "orchestration",
    description: "Programming model for LM pipelines",
    integrationValue: 8,
    explorationStatus: "known",
    tags: ["programming-model", "optimization", "chains"],
    notes: "Enables learning to optimize LLM calls"
  },
  {
    id: "unsloth",
    name: "Unsloth",
    category: "fine-tuning-tools",
    description: "2x faster QLoRA fine-tuning",
    integrationValue: 9,
    explorationStatus: "known",
    tags: ["fine-tuning", "lora", "optimization"],
    notes: "Dramatically reduces fine-tuning time"
  },
  {
    id: "qdrant",
    name: "Qdrant",
    category: "vector-dbs",
    description: "Vector similarity search engine",
    integrationValue: 8,
    explorationStatus: "exploring",
    tags: ["vector-db", "search", "rust"],
    notes: "High-performance with rich filtering"
  },
  {
    id: "ragas",
    name: "RAGAS",
    category: "evaluation",
    description: "RAG evaluation framework",
    integrationValue: 7,
    explorationStatus: "known",
    tags: ["evaluation", "rag", "metrics"],
    notes: "Metrics for evaluating RAG systems"
  }
];

export class AiTechExplorer {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.catalogPath = path.join(dataDir, "ai_tech_catalog.json");
    this.catalog = {};
  }

  async init() {
    try {
      if (fs.existsSync(this.catalogPath)) {
        const data = JSON.parse(fs.readFileSync(this.catalogPath, "utf8"));
        this.catalog = data;
      } else {
        // Initialize with default catalog
        this.catalog = {};
        for (const entry of DEFAULT_CATALOG) {
          const now = Date.now();
          this.catalog[entry.id] = {
            ...entry,
            addedAt: now,
            lastUpdated: now
          };
        }
        this._save();
      }
    } catch (err) {
      console.error("Failed to initialize AI Tech Catalog:", err);
      // Fallback to defaults
      this.catalog = {};
      const now = Date.now();
      for (const entry of DEFAULT_CATALOG) {
        this.catalog[entry.id] = {
          ...entry,
          addedAt: now,
          lastUpdated: now
        };
      }
    }
  }

  _save() {
    try {
      fs.writeFileSync(
        this.catalogPath,
        JSON.stringify(this.catalog, null, 2),
        "utf8"
      );
    } catch (err) {
      console.error("Failed to save AI Tech Catalog:", err);
    }
  }

  /**
   * Get all catalog entries, optionally filtered by category
   */
  getCatalog({ category = null } = {}) {
    const entries = Object.values(this.catalog);
    if (!category) return entries;
    return entries.filter(e => e.category === category);
  }

  /**
   * Get a single entry by ID
   */
  getEntry(id) {
    return this.catalog[id] || null;
  }

  /**
   * Upsert an entry (add or update by ID)
   */
  upsertEntry(entry) {
    if (!entry.id || !entry.name || !entry.category) {
      throw new Error("Entry must have id, name, and category");
    }
    const now = Date.now();
    const existing = this.catalog[entry.id];
    this.catalog[entry.id] = {
      ...entry,
      addedAt: existing?.addedAt || now,
      lastUpdated: now
    };
    this._save();
    return this.catalog[entry.id];
  }

  /**
   * Get a summary string for injection into prompts
   * Format: "AVAILABLE AI TOOLS:\n- vLLM (inference-engines): integrated\n..."
   */
  getSummaryForPrompt() {
    const entries = Object.values(this.catalog).sort((a, b) =>
      b.integrationValue - a.integrationValue
    );

    if (entries.length === 0) {
      return "AVAILABLE AI TOOLS:\n(No tools currently cataloged)";
    }

    const lines = ["AVAILABLE AI TOOLS:"];
    const byStatus = {};

    for (const entry of entries) {
      const status = entry.explorationStatus || "unknown";
      if (!byStatus[status]) byStatus[status] = [];
      byStatus[status].push(entry);
    }

    // Group by status: integrated > known > exploring > unknown
    const statusOrder = ["integrated", "known", "exploring", "unknown"];
    for (const status of statusOrder) {
      if (byStatus[status]) {
        if (lines.length > 1) lines.push(""); // Blank line between groups
        lines.push(`${status.toUpperCase()}:`);
        for (const entry of byStatus[status]) {
          const tags = entry.tags?.length
            ? ` [${entry.tags.join(", ")}]`
            : "";
          lines.push(
            `- ${entry.name} (${entry.category})${tags}`
          );
        }
      }
    }

    return lines.join("\n");
  }

  /**
   * Get statistics about the catalog
   */
  getStats() {
    const entries = Object.values(this.catalog);
    const byCategory = {};
    const byStatus = {};

    for (const entry of entries) {
      // Count by category
      byCategory[entry.category] = (byCategory[entry.category] || 0) + 1;

      // Count by status
      const status = entry.explorationStatus || "unknown";
      byStatus[status] = (byStatus[status] || 0) + 1;
    }

    return {
      total: entries.length,
      byCategory,
      byStatus,
      averageIntegrationValue: entries.length > 0
        ? Math.round(
            (entries.reduce((sum, e) => sum + (e.integrationValue || 0), 0) /
              entries.length) * 10
          ) / 10
        : 0
    };
  }
}
