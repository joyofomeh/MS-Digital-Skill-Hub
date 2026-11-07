import crypto from "node:crypto";

export const GROUP_IMAGE_KEYS = ["group1", "group2", "group3", "group4", "group5"];
export const STATUS_IMAGE_KEY = "status";
export const ALL_IMAGE_KEYS = [...GROUP_IMAGE_KEYS, STATUS_IMAGE_KEY];

const MAX_IMAGE_BYTES = 2 * 1024 * 1024;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 6;

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function randomCode(length = CODE_LENGTH) {
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

export function buildTrainingCode(prefix, random = randomCode()) {
  const base = String(prefix || "").trim();
  if (!base) return random;
  return base.endsWith("/") ? `${base}${random}` : `${base}/${random}`;
}

export function parseDataImage(raw) {
  if (typeof raw !== "string" || !raw.trim()) {
    return { error: "must be a non-empty base64 string" };
  }

  let mimeType = "image/jpeg";
  let data = raw.trim();

  const dataUrlMatch = data.match(/^data:(image\/[a-z0-9.+_-]+);base64,/i);
  if (dataUrlMatch) {
    mimeType = dataUrlMatch[1].toLowerCase();
    data = data.slice(dataUrlMatch[0].length);
  }

  if (!/^[A-Za-z0-9+/=\s]+$/.test(data)) {
    return { error: "contains characters that are not valid base64" };
  }

  const compact = data.replace(/\s+/g, "");
  let byteLength;
  try {
    byteLength = Buffer.from(compact, "base64").length;
  } catch {
    return { error: "is not decodable base64" };
  }

  if (byteLength === 0) {
    return { error: "is empty" };
  }
  if (byteLength > MAX_IMAGE_BYTES) {
    return { error: `is larger than 2MB (${(byteLength / (1024 * 1024)).toFixed(2)}MB)` };
  }

  return { mimeType, data: compact };
}

export function normalizeImagesPayload(body) {
  const images = body?.images;
  const errors = {};
  const normalized = {};

  const pick = (key) => {
    if (images && !Array.isArray(images) && images[key] !== undefined) return images[key];
    if (Array.isArray(images)) {
      const index = ALL_IMAGE_KEYS.indexOf(key);
      return images[index];
    }
    if (body?.[key] !== undefined) return body[key];
    return undefined;
  };

  for (const key of ALL_IMAGE_KEYS) {
    const parsed = parseDataImage(pick(key));
    if (parsed.error) {
      errors[key] = `Image "${key}" ${parsed.error}`;
    } else {
      normalized[key] = parsed;
    }
  }

  return { normalized, errors };
}

export function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

export function parseSheetDate(value, { endOfDay = false } = {}) {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return endOfDay && value.getHours() === 0 && value.getMinutes() === 0 && value.getSeconds() === 0
      ? new Date(value.getTime() + 24 * 60 * 60 * 1000 - 1)
      : value;
  }

  const raw = String(value).trim();
  if (!raw) return null;

  const dateOnly = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) {
    const date = new Date(`${raw}T00:00:00`);
    if (Number.isNaN(date.getTime())) return null;
    return endOfDay ? new Date(date.getTime() + 24 * 60 * 60 * 1000 - 1) : date;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function toSheetTimestamp(date = new Date()) {
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

export function chunk(items, size) {
  const out = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
