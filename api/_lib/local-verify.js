import { GROUP_IMAGE_KEYS } from "./utils.js";

const MIN_TEXT_LENGTH = 20;
const MIN_GROUP_NAME_LENGTH = 3;

function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function compactText(value) {
  return normalizeText(value).replace(/\s+/g, "");
}

function hasBrand(text) {
  const normalized = normalizeText(text);
  const compact = normalized.replace(/\s+/g, "");

  return (
    normalized.includes("ms digital skill hub") ||
    compact.includes("msdigitalskillhub")
  );
}

function findDuplicateGroup(normalizedText, otherGroupNames) {
  return (Array.isArray(otherGroupNames) ? otherGroupNames : [])
    .map(normalizeText)
    .filter((name) => name.length >= MIN_GROUP_NAME_LENGTH)
    .find((name) => normalizedText.includes(name));
}

export function verifySlotText({
  slot,
  text,
  shareCode,
  expectedGroupName = "",
  otherGroupNames = []
}) {
  const raw = String(text || "").trim();

  if (raw.length < MIN_TEXT_LENGTH) {
    return {
      valid: false,
      reason:
        "We could not read enough text from this screenshot. Please upload a clearer, uncropped screenshot."
    };
  }

  const normalized = normalizeText(raw);
  const compact = normalized.replace(/\s+/g, "");
  const code = compactText(shareCode);

  if (!code || !compact.includes(code)) {
    return {
      valid: false,
      reason:
        "Your unique verification code was not found in this screenshot. Copy the share message exactly and make sure the code is visible."
    };
  }

  if (!hasBrand(raw)) {
    return {
      valid: false,
      reason:
        "The MS Digital Skill Hub share message was not found in this screenshot. Please upload the screenshot showing the shared message."
    };
  }

  if (!GROUP_IMAGE_KEYS.includes(slot)) {
    return { valid: true, reason: "Screenshot verified." };
  }

  const duplicate = findDuplicateGroup(normalized, otherGroupNames);
  if (duplicate) {
    return {
      valid: false,
      reason:
        "This screenshot appears to be from a WhatsApp group you already used. Please upload a screenshot from a different group."
    };
  }

  const expected = normalizeText(expectedGroupName);
  const groupVisible = expected.length >= MIN_GROUP_NAME_LENGTH && normalized.includes(expected);

  return {
    valid: true,
    reason: groupVisible
      ? "Screenshot verified."
      : "Verification code found. The group name was not clearly readable, but duplicate checks passed."
  };
}
