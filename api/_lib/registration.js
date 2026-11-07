import { ALL_IMAGE_KEYS, GROUP_IMAGE_KEYS } from "./utils.js";
import { createSuccessToken } from "./tokens.js";

export const SLOT_LABELS = {
  group1: "Group 1",
  group2: "Group 2",
  group3: "Group 3",
  group4: "Group 4",
  group5: "Group 5",
  status: "Status"
};

const DEFAULT_SHARE_MESSAGE =
  "Join MS Digital Skill Hub for practical digital skills training. " +
  "Register at https://www.msdigitalskillhub.com.ng/register.html";

export function renderShareMessage(template, shareCode) {
  const code = String(shareCode || "").trim();
  const custom = String(template || "").trim();
  const base = custom || DEFAULT_SHARE_MESSAGE;
  const hasCodePlaceholder = /\{\{\s*code\s*\}\}|\[code\]|\{code\}/i.test(base);

  if (hasCodePlaceholder) {
    return base.replace(/\{\{\s*code\s*\}\}|\[code\]|\{code\}/gi, code);
  }

  return code ? `Verification code: ${code}\n${base}` : base;
}

export function normalizeGroupName(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function publicSlots(draft, slots) {
  const bySlot = new Map((slots || []).map((slot) => [slot.slot, slot]));

  return ALL_IMAGE_KEYS.map((key, index) => {
    const record = bySlot.get(key);
    return {
      slot: key,
      label: SLOT_LABELS[key],
      groupName:
        record?.groupName ||
        (GROUP_IMAGE_KEYS.includes(key) ? draft.groupNames?.[index] || "" : ""),
      status: record?.status || "empty",
      reason: record?.reason || "",
      updatedAt: record?.updatedAt || ""
    };
  });
}

export function publicDraft(draft, slots) {
  const publicSlotList = publicSlots(draft, slots);
  const approved = draft.status === "approved" && Boolean(draft.code);
  const payload = {
    draftId: draft.draftId,
    fullName: draft.fullName,
    track: draft.track,
    status: draft.status,
    groupNames: draft.groupNames,
    shareCode: draft.shareCode || "",
    shareMessage: draft.shareMessage || "",
    slots: publicSlotList,
    canFinalize: publicSlotList.every((slot) => slot.status === "accepted")
  };

  if (approved) {
    const successToken = createSuccessToken({ code: draft.code, email: draft.email });
    payload.code = draft.code;
    payload.redirectUrl = `/success.html?token=${encodeURIComponent(successToken)}`;
    payload.emailSent = draft.emailSent;
  }

  return payload;
}

export function fail(res, statusCode, message, extra = {}) {
  return res.status(statusCode).json({ success: false, message, ...extra });
}

export function serverError(res, context, error) {
  console.error(context, error);
  return fail(
    res,
    500,
    "Registration is temporarily unavailable. Please try again shortly."
  );
}
