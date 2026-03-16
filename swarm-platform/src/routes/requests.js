export function registerRequestRoutes(app, deps) {
  const { requireAdmin, resourceRequests } = deps;

  if (!resourceRequests) {
    console.warn("[requests routes] ResourceRequests not initialized");
    return;
  }

  // GET /api/requests - all requests
  app.get("/api/requests", (_req, res) => {
    const requests = resourceRequests.getAll();
    res.json({ requests });
  });

  // GET /api/requests/pending - pending requests only
  app.get("/api/requests/pending", (_req, res) => {
    const requests = resourceRequests.getPending();
    res.json({ requests });
  });

  // POST /api/requests - manually create a request
  app.post("/api/requests", requireAdmin, (req, res) => {
    const { type, name, reason, requestedBy, round } = req.body || {};

    if (!type || !name) {
      return res.status(400).json({ ok: false, error: "type and name required" });
    }

    try {
      const request = resourceRequests.requestResource({
        type,
        name,
        reason: reason || "",
        requestedBy: requestedBy || "admin",
        round: round || null
      });
      res.status(201).json({ ok: true, request });
    } catch (err) {
      res.status(500).json({ ok: false, error: err?.message || "unknown" });
    }
  });

  // POST /api/requests/:id/approve - approve a request
  app.post("/api/requests/:id/approve", requireAdmin, (req, res) => {
    const { id } = req.params;
    const request = resourceRequests.approve(id);
    if (!request) {
      return res.status(404).json({ ok: false, error: "request not found" });
    }
    res.json({ ok: true, request });
  });

  // POST /api/requests/:id/reject - reject a request
  app.post("/api/requests/:id/reject", requireAdmin, (req, res) => {
    const { id } = req.params;
    const request = resourceRequests.reject(id);
    if (!request) {
      return res.status(404).json({ ok: false, error: "request not found" });
    }
    res.json({ ok: true, request });
  });

  // GET /api/requests/check-env - run checkEnvDetection
  app.get("/api/requests/check-env", (_req, res) => {
    const detected = resourceRequests.checkEnvDetection();
    res.json({ ok: true, detected, count: detected.length });
  });
}
