export function registerRagRoutes(app, deps) {
  const { ragPipeline } = deps;

  if (!ragPipeline) {
    console.warn('[RAG] Routes registered but ragPipeline not initialized');
  }

  // GET /api/rag/search?q=query&topK=5&category=research
  app.get('/api/rag/search', (req, res) => {
    try {
      const { q, topK = 5, category = null } = req.query;

      if (!ragPipeline) {
        return res.status(503).json({ error: 'RAG pipeline not initialized' });
      }

      if (!q) {
        return res.status(400).json({ error: 'Query parameter q is required' });
      }

      const results = ragPipeline.search(q, {
        topK: Math.min(Math.max(parseInt(topK) || 5, 1), 20),
        category: category === 'null' ? null : category
      });

      res.json({
        query: q,
        resultCount: results.length,
        results
      });
    } catch (err) {
      console.error('[RAG] /search error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/rag/context?q=query&topK=3
  app.get('/api/rag/context', (req, res) => {
    try {
      const { q, topK = 3 } = req.query;

      if (!ragPipeline) {
        return res.status(503).json({ error: 'RAG pipeline not initialized' });
      }

      if (!q) {
        return res.status(400).json({ error: 'Query parameter q is required' });
      }

      const context = ragPipeline.getContext(q, {
        topK: Math.min(Math.max(parseInt(topK) || 3, 1), 10)
      });

      res.json({
        query: q,
        context,
        isEmpty: !context || context.trim().length === 0
      });
    } catch (err) {
      console.error('[RAG] /context error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // GET /api/rag/stats
  app.get('/api/rag/stats', (req, res) => {
    try {
      if (!ragPipeline) {
        return res.status(503).json({ error: 'RAG pipeline not initialized' });
      }

      const stats = ragPipeline.getStats();
      res.json(stats);
    } catch (err) {
      console.error('[RAG] /stats error:', err);
      res.status(500).json({ error: err.message });
    }
  });

  // POST /api/rag/add (requireAdmin) - manually add a document
  app.post('/api/rag/add', (req, res) => {
    try {
      const { requireAdmin } = require('../auth.js');

      if (!ragPipeline) {
        return res.status(503).json({ error: 'RAG pipeline not initialized' });
      }

      // Check admin auth
      if (!req.headers.authorization || !req.headers.authorization.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing or invalid authorization header' });
      }

      const token = req.headers.authorization.slice(7);
      const adminKey = process.env.ADMIN_API_KEY || '';
      if (token !== adminKey) {
        return res.status(403).json({ error: 'Unauthorized' });
      }

      const { title, content, category = 'research' } = req.body;

      if (!title || !content) {
        return res.status(400).json({ error: 'title and content are required' });
      }

      ragPipeline
        .addDocument({
          title,
          content,
          category,
          source: 'manual'
        })
        .then(docId => {
          res.json({ docId, message: 'Document added successfully' });
        })
        .catch(err => {
          console.error('[RAG] addDocument failed:', err);
          res.status(500).json({ error: err.message });
        });
    } catch (err) {
      console.error('[RAG] /add error:', err);
      res.status(500).json({ error: err.message });
    }
  });
}
