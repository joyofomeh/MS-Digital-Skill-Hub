export default function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return res.status(405).json({ success: false, message: "Method not allowed. Use GET." });
  }

  const turnstileSiteKey = String(process.env.TURNSTILE_SITE_KEY || "").trim();
  const required = Boolean(process.env.TURNSTILE_SECRET_KEY);

  if (required && !turnstileSiteKey) {
    console.error("TURNSTILE_SECRET_KEY is set but TURNSTILE_SITE_KEY is missing.");
  }

  res.setHeader("Cache-Control", "public, max-age=300");
  return res.status(200).json({
    turnstileRequired: required,
    turnstileSiteKey
  });
}
