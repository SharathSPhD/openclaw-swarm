function isPlainObject(v) {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validateDispatchBody(body) {
  if (!isPlainObject(body)) return { ok: false, error: "body must be object" };
  if (typeof body.teamId !== "string" || !body.teamId.trim()) return { ok: false, error: "teamId required" };
  if (typeof body.task !== "string" || body.task.trim().length < 3) return { ok: false, error: "task must be at least 3 chars" };
  if (body.task.length > 4000) return { ok: false, error: "task too long" };
  return { ok: true };
}

export function validateEventBody(body) {
  if (!isPlainObject(body)) return { ok: false, error: "body must be object" };
  if (body.type && typeof body.type !== "string") return { ok: false, error: "type invalid" };
  if (body.teamId && typeof body.teamId !== "string") return { ok: false, error: "teamId invalid" };
  if (body.payload && !isPlainObject(body.payload)) return { ok: false, error: "payload invalid" };
  return { ok: true };
}
