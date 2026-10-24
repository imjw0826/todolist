// Relay for TypeSafe AI's Jev. The API does not allow browser (CORS) calls,
// so the mind map posts here and this function forwards the request.
//
// No key is stored here: the caller's own `Authorization` header is passed
// through unchanged. Only the mind map's origins are allowed.
const UPSTREAM = "https://api.typesafe.ai/v1/systemone";
const ALLOWED_ORIGINS = new Set([
  "https://imjw0826.github.io",
  "http://localhost:5173",
]);

module.exports = async (req, res) => {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Max-Age", "86400");
  }

  if (req.method === "OPTIONS") return res.status(204).end();
  if (!ALLOWED_ORIGINS.has(origin)) return res.status(403).json({ error: "origin not allowed" });
  if (req.method !== "POST") return res.status(405).json({ error: "method not allowed" });

  const auth = req.headers.authorization;
  if (!auth) return res.status(401).json({ error: "missing Authorization header" });

  try {
    const upstream = await fetch(UPSTREAM, {
      method: "POST",
      headers: { Authorization: auth, "Content-Type": "application/json" },
      body: typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}),
    });
    const text = await upstream.text();
    res.status(upstream.status);
    res.setHeader("Content-Type", upstream.headers.get("content-type") ?? "application/json");
    return res.send(text);
  } catch (err) {
    return res.status(502).json({ error: "could not reach Jev", detail: String(err) });
  }
};
