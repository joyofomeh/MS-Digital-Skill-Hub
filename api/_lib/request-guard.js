import { sha256 } from "./utils.js";

const TURNSTILE_VERIFY_URL =
  "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const RATE_BUCKETS = new Map();
const MAX_RATE_BUCKETS = 5000;

export function clientIp(req) {
  const forwarded = String(req.headers?.["x-forwarded-for"] || "")
    .split(",")[0]
    .trim();
  return String(
    req.headers?.["x-real-ip"] ||
      req.headers?.["x-vercel-forwarded-for"] ||
      forwarded ||
      req.socket?.remoteAddress ||
      "unknown"
  ).trim();
}

export function clientIpHash(req) {
  return sha256(clientIp(req));
}

export function checkRateLimit(key, limit, windowMs) {
  const now = Date.now();
  const bucket = RATE_BUCKETS.get(key);

  if (bucket && bucket.resetAt > now) {
    if (bucket.count >= limit) {
      return {
        allowed: false,
        retryAfter: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000))
      };
    }

    bucket.count += 1;
    return { allowed: true, retryAfter: 0 };
  }

  RATE_BUCKETS.set(key, { count: 1, resetAt: now + windowMs });

  if (RATE_BUCKETS.size > MAX_RATE_BUCKETS) {
    for (const [bucketKey, value] of RATE_BUCKETS) {
      if (value.resetAt <= now) RATE_BUCKETS.delete(bucketKey);
    }
  }

  return { allowed: true, retryAfter: 0 };
}

export async function verifyTurnstile(token, remoteIp) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) return { ok: true, skipped: true };

  const response = String(token || "").trim();
  if (!response) return { ok: false, reason: "missing" };

  const form = new URLSearchParams({ secret, response });
  if (remoteIp && remoteIp !== "unknown") form.set("remoteip", remoteIp);

  try {
    const res = await fetch(TURNSTILE_VERIFY_URL, {
      method: "POST",
      body: form
    });
    const data = await res.json().catch(() => ({}));

    if (data.success) return { ok: true, skipped: false };

    console.warn(
      "Turnstile verification rejected:",
      Array.isArray(data["error-codes"]) ? data["error-codes"].join(", ") : "unknown"
    );
    return { ok: false, reason: "rejected" };
  } catch (error) {
    console.error("Turnstile verification failed:", error);
    return { ok: false, reason: "unavailable" };
  }
}
