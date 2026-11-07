import crypto from "node:crypto";

const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DRAFT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function getSecret() {
  const secret =
    process.env.SUCCESS_TOKEN_SECRET ||
    process.env.GOOGLE_SHEETS_PRIVATE_KEY ||
    process.env.MAIL_PASSWORD;

  if (!secret) {
    throw new Error("Missing SUCCESS_TOKEN_SECRET (or fallback signing secret).");
  }

  return secret;
}

function signPayload(payload) {
  const data = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecret())
    .update(data)
    .digest("base64url");

  return `${data}.${signature}`;
}

function verifySignedPayload(token) {
  const [data, signature] = String(token || "").split(".");
  if (!data || !signature) return null;

  const expected = crypto
    .createHmac("sha256", getSecret())
    .update(data)
    .digest("base64url");

  const providedBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    providedBuffer.length !== expectedBuffer.length ||
    !crypto.timingSafeEqual(providedBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(data, "base64url").toString("utf8"));
    if (!payload || payload.v !== 1) return null;
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function createSuccessToken({ code, email }, ttlMs = TOKEN_TTL_MS) {
  return signPayload({
    v: 1,
    code: String(code || "").trim(),
    email: String(email || "").trim().toLowerCase(),
    exp: Date.now() + ttlMs
  });
}

export function verifySuccessToken(token) {
  const payload = verifySignedPayload(token);
  if (!payload || !payload.code || !payload.email) return null;
  return payload;
}

export function createDraftToken({ draftId, email }, ttlMs = DRAFT_TOKEN_TTL_MS) {
  return signPayload({
    v: 1,
    kind: "draft",
    draftId: String(draftId || "").trim(),
    email: String(email || "").trim().toLowerCase(),
    exp: Date.now() + ttlMs
  });
}

export function verifyDraftToken(token) {
  const payload = verifySignedPayload(token);
  if (!payload || payload.kind !== "draft" || !payload.draftId || !payload.email) {
    return null;
  }
  return payload;
}
