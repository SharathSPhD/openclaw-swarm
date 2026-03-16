import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'from', 'is', 'it', 'as', 'be', 'this', 'that', 'are', 'was', 'were', 'been', 'have',
  'has', 'had', 'do', 'did', 'will', 'would', 'could', 'should', 'may', 'might', 'can',
  'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'each', 'few', 'more', 'most',
  'other', 'some', 'such', 'into', 'than', 'then', 'there', 'these', 'those', 'when',
  'where', 'which', 'who', 'whom', 'how', 'what', 'all', 'any', 'every', 'neither',
  'none', 'own', 'same', 'too', 'very'
]);

export class RagPipeline {
  constructor({ dataDir }) {
    this.dataDir = dataDir;
    this.corpusDir = path.join(dataDir, 'rag-corpus');
    this.indexPath = path.join(dataDir, 'rag-index.json');
    this.index = {};
    this.docMetadata = {}; // Cache doc metadata for faster lookups
  }

  async init() {
    try {
      // Create corpus directory if missing
      if (!fs.existsSync(this.corpusDir)) {
        fs.mkdirSync(this.corpusDir, { recursive: true });
      }

      // Load or rebuild index
      await this._buildIndex();
      console.log(`[RAG] Initialized with ${Object.keys(this.docMetadata).length} documents`);
    } catch (err) {
      console.error('[RAG] Init failed:', err.message);
      throw err;
    }
  }

  async addDocument({ title, content, category = 'research', source = 'manual', roundId = null, teamId = null, score = 0 }) {
    try {
      const docId = `doc-${crypto.randomUUID()}`;
      const chunks = this._chunkContent(content);
      const keywords = this._extractKeywords(content);

      const doc = {
        id: docId,
        title,
        content,
        chunks,
        category,
        source,
        roundId,
        teamId,
        score,
        ts: Date.now(),
        keywords
      };

      // Save document file
      const docPath = path.join(this.corpusDir, `${docId}.json`);
      fs.writeFileSync(docPath, JSON.stringify(doc, null, 2));

      // Update metadata cache
      this.docMetadata[docId] = {
        id: docId,
        title,
        category,
        source,
        roundId,
        teamId,
        score,
        ts: doc.ts,
        keywords
      };

      // Update index
      for (const keyword of keywords) {
        if (!this.index[keyword]) {
          this.index[keyword] = [];
        }
        if (!this.index[keyword].includes(docId)) {
          this.index[keyword].push(docId);
        }
      }

      // Persist index
      fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));

      console.log(`[RAG] Added document: ${docId} (${keywords.length} keywords, ${chunks.length} chunks)`);
      return docId;
    } catch (err) {
      console.error('[RAG] addDocument failed:', err.message);
      throw err;
    }
  }

  search(query, { topK = 5, category = null } = {}) {
    try {
      const tokens = this._tokenize(query);
      if (tokens.length === 0) return [];

      // Score documents by keyword overlap using TF-IDF
      const scores = {};
      for (const token of tokens) {
        const docIds = this.index[token] || [];
        for (const docId of docIds) {
          if (!scores[docId]) scores[docId] = 0;
          // IDF: log(totalDocs / docsWithTerm)
          const idf = Math.log((Object.keys(this.docMetadata).length + 1) / (docIds.length + 1));
          scores[docId] += idf;
        }
      }

      // Filter by category if specified
      let results = Object.entries(scores)
        .filter(([docId]) => {
          if (!category) return true;
          return this.docMetadata[docId]?.category === category;
        })
        .map(([docId, score]) => ({
          id: docId,
          score
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, topK);

      // Load full documents
      return results
        .map(r => {
          const metadata = this.docMetadata[r.id];
          if (!metadata) return null;

          try {
            const docPath = path.join(this.corpusDir, `${r.id}.json`);
            const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));
            return {
              id: r.id,
              title: metadata.title,
              content: doc.chunks[0] || doc.content.slice(0, 500),
              score: r.score,
              category: metadata.category
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean);
    } catch (err) {
      console.error('[RAG] search failed:', err.message);
      return [];
    }
  }

  getContext(query, { topK = 3 } = {}) {
    try {
      const results = this.search(query, { topK });
      if (results.length === 0) return '';

      const lines = ['RELEVANT CONTEXT:'];
      for (const doc of results) {
        lines.push(`[${doc.title}]`);
        lines.push(doc.content.slice(0, 300));
        lines.push('');
      }

      return lines.join('\n');
    } catch (err) {
      console.error('[RAG] getContext failed:', err.message);
      return '';
    }
  }

  getStats() {
    try {
      const docs = Object.values(this.docMetadata);
      const categories = {};
      let corpusBytes = 0;

      for (const doc of docs) {
        categories[doc.category] = (categories[doc.category] || 0) + 1;
        try {
          const docPath = path.join(this.corpusDir, `${doc.id}.json`);
          corpusBytes += fs.statSync(docPath).size;
        } catch {
          // Skip if file missing
        }
      }

      return {
        docCount: docs.length,
        indexSize: Object.keys(this.index).length,
        categories,
        corpusBytes
      };
    } catch (err) {
      console.error('[RAG] getStats failed:', err.message);
      return { docCount: 0, indexSize: 0, categories: {}, corpusBytes: 0 };
    }
  }

  async _buildIndex() {
    try {
      // Try to load existing index first
      if (fs.existsSync(this.indexPath)) {
        const indexData = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'));
        this.index = indexData;
      } else {
        this.index = {};
      }

      // Scan corpus directory and rebuild metadata cache
      this.docMetadata = {};
      if (fs.existsSync(this.corpusDir)) {
        const files = fs.readdirSync(this.corpusDir).filter(f => f.endsWith('.json'));
        for (const file of files) {
          try {
            const docPath = path.join(this.corpusDir, file);
            const doc = JSON.parse(fs.readFileSync(docPath, 'utf8'));
            this.docMetadata[doc.id] = {
              id: doc.id,
              title: doc.title,
              category: doc.category,
              source: doc.source,
              roundId: doc.roundId,
              teamId: doc.teamId,
              score: doc.score,
              ts: doc.ts,
              keywords: doc.keywords
            };

            // Rebuild index if empty or missing keywords
            if (Object.keys(this.index).length === 0 && doc.keywords) {
              for (const keyword of doc.keywords) {
                if (!this.index[keyword]) {
                  this.index[keyword] = [];
                }
                if (!this.index[keyword].includes(doc.id)) {
                  this.index[keyword].push(doc.id);
                }
              }
            }
          } catch {
            // Skip invalid doc files
          }
        }

        // Persist rebuilt index
        if (Object.keys(this.index).length > 0) {
          fs.writeFileSync(this.indexPath, JSON.stringify(this.index, null, 2));
        }
      }
    } catch (err) {
      console.error('[RAG] _buildIndex failed:', err.message);
      throw err;
    }
  }

  _chunkContent(content, chunkSize = 500, overlap = 100) {
    const chunks = [];
    for (let i = 0; i < content.length; i += chunkSize - overlap) {
      chunks.push(content.slice(i, i + chunkSize));
    }
    return chunks;
  }

  _extractKeywords(text, limit = 20) {
    const words = this._tokenize(text.toLowerCase());
    const freq = {};

    for (const word of words) {
      freq[word] = (freq[word] || 0) + 1;
    }

    // Sort by frequency and take top limit
    return Object.entries(freq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([word]) => word);
  }

  _tokenize(text) {
    return text
      .toLowerCase()
      .match(/\b[a-z0-9]+\b/g)
      ?.filter(word => word.length > 2 && !STOPWORDS.has(word)) || [];
  }
}
