export function requireAdmin(req, res, next) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) return next();

  const provided = req.header("x-api-key");
  if (provided !== expected) {
    return res.status(401).json({ ok: false, error: "unauthorized" });
  }
  return next();
}
