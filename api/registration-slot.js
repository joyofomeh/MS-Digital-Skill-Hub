import {
  ConfigError,
  findHashConflicts,
  getDraftRecord,
  getDraftSlotRecords,
  getHashRows,
  isEarliestReservation,
  reserveHashRow,
  updateDraft,
  updateHashRow,
  upsertDraftSlot
} from "./_lib/sheets.js";
import { analyzeImagePayload, ImageValidationError } from "./_lib/images.js";
import { verifySlotText } from "./_lib/local-verify.js";
import { verifyDraftToken } from "./_lib/tokens.js";
import { ALL_IMAGE_KEYS, GROUP_IMAGE_KEYS, sha256, sleep } from "./_lib/utils.js";
import { checkRateLimit } from "./_lib/request-guard.js";
import {
  SLOT_LABELS,
  fail,
  normalizeGroupName,
  serverError
} from "./_lib/registration.js";

export const maxDuration = 60;

const RESERVATION_TTL_MS = 15 * 60 * 1000;

function readToken(req, body) {
  const authorization = String(req.headers?.authorization || "");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return String(body.token ?? "").trim();
}

async function saveSlot(draftId, slot, groupName, analyzed, status, reason, slotRows) {
  await upsertDraftSlot(
    draftId,
    slot,
    {
      groupName,
      sha256: analyzed?.sha256 || "",
      pHash: analyzed?.pHash || "",
      status,
      reason,
      mimeType: analyzed?.mimeType || "",
      bytes: analyzed?.bytes || 0
    },
    slotRows
  );
}

function slotResponse(slot, groupName, status, reason) {
  return {
    slot,
    label: SLOT_LABELS[slot],
    groupName,
    status,
    reason
  };
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "Method not allowed. Use POST.");
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const claims = verifyDraftToken(readToken(req, body));
  if (!claims) {
    return fail(res, 401, "This registration session is invalid or has expired. Please start again.");
  }

  const uploadLimit = checkRateLimit(
    `slot:${claims.draftId}`,
    60,
    15 * 60 * 1000
  );
  if (!uploadLimit.allowed) {
    res.setHeader("Retry-After", String(uploadLimit.retryAfter));
    return fail(res, 429, "Too many uploads. Please wait a few minutes and try again.");
  }

  const slot = String(body.slot ?? "").trim();
  if (!ALL_IMAGE_KEYS.includes(slot)) {
    return fail(res, 400, "Unknown screenshot slot.");
  }

  const isGroup = GROUP_IMAGE_KEYS.includes(slot);
  const groupIndex = GROUP_IMAGE_KEYS.indexOf(slot);
  const groupName = isGroup ? String(body.groupName ?? "").trim() : "";
  const ocrText = String(body.ocrText ?? "").slice(0, 20000);

  if (isGroup && (groupName.length < 2 || groupName.length > 120)) {
    return fail(res, 400, "Enter the WhatsApp group name (2 to 120 characters).");
  }

  let reservedRow = null;

  try {
    const draftRecord = await getDraftRecord(claims.draftId);
    const draft = draftRecord?.draft;
    if (!draft || draft.email.toLowerCase() !== claims.email) {
      return fail(res, 404, "Registration draft was not found. Please start again.");
    }

    if (draft.status === "finalizing") {
      return fail(res, 409, "This registration is already being finalized.");
    }
    if (draft.status === "approved") {
      return fail(res, 409, "This registration has already been finalized.");
    }

    let analyzed;
    const slotRecords = await getDraftSlotRecords(draft.draftId);
    const slotRows = slotRecords.rows;

    try {
      const imageInfo = await analyzeImagePayload(body.image);
      analyzed = { ...imageInfo, sha256: sha256(imageInfo.data) };
    } catch (error) {
      if (error instanceof ImageValidationError) {
        await saveSlot(draft.draftId, slot, groupName, null, "rejected", error.message, slotRows);
        return res.status(422).json({
          success: false,
          message: error.message,
          slot: slotResponse(slot, groupName, "rejected", error.message)
        });
      }
      throw error;
    }

    if (analyzed.lowInformation) {
      const reason = "This screenshot appears blank or too plain. Please upload a clear screenshot of the required WhatsApp screen.";
      await saveSlot(draft.draftId, slot, groupName, analyzed, "rejected", reason, slotRows);
      return res.status(422).json({
        success: false,
        message: reason,
        slot: slotResponse(slot, groupName, "rejected", reason)
      });
    }

    const existingSlots = slotRecords.infos;
    const acceptedGroups = existingSlots.filter(
      (item) =>
        item.slot !== slot &&
        GROUP_IMAGE_KEYS.includes(item.slot) &&
        item.status === "accepted" &&
        item.groupName
    );

    if (isGroup) {
      const wantedName = normalizeGroupName(groupName);
      const nameConflict = acceptedGroups.find(
        (item) => normalizeGroupName(item.groupName) === wantedName
      );
      if (nameConflict) {
        const reason = "This WhatsApp group has already been used for another requirement. Please upload a screenshot from a different group.";
        await saveSlot(draft.draftId, slot, groupName, analyzed, "rejected", reason, slotRows);
        return res.status(409).json({
          success: false,
          message: reason,
          slot: slotResponse(slot, groupName, "rejected", reason)
        });
      }
    }

    const reservation = await reserveHashRow({
      sha256: analyzed.sha256,
      pHash: analyzed.pHash,
      email: draft.email,
      draftId: draft.draftId,
      slot,
      ttlMs: RESERVATION_TTL_MS
    });
    reservedRow = reservation.row;

    await sleep(250);

    const hashRows = await getHashRows();
    const conflicts = findHashConflicts(hashRows, {
      sha256: analyzed.sha256,
      pHash: analyzed.pHash,
      draftId: draft.draftId,
      slot
    });

    if (conflicts.length && !isEarliestReservation(reservation.info, conflicts)) {
      await updateHashRow(reservedRow, { status: "rejected" });
      reservedRow = null;

      const sameDraft = conflicts.some((item) => item.draftId === draft.draftId);
      const exact = conflicts.some((item) => item.type === "exact");
      const reason = exact
        ? sameDraft
          ? "You already uploaded this exact screenshot for another requirement. Please upload a different screenshot."
          : "This exact screenshot has already been submitted. Please upload a fresh screenshot."
        : sameDraft
          ? "This screenshot is too similar to one you already uploaded. Please upload a different screenshot."
          : "This screenshot is too similar to one already submitted. Please upload a different screenshot.";

      await saveSlot(draft.draftId, slot, groupName, analyzed, "rejected", reason, slotRows);
      return res.status(409).json({
        success: false,
        message: reason,
        slot: slotResponse(slot, groupName, "rejected", reason)
      });
    }

    if (isGroup) {
      await updateDraft(
        draft.draftId,
        { [`Group ${groupIndex + 1} Name`]: groupName },
        draftRecord.row
      );
    }

    const verdict = verifySlotText({
      slot,
      text: ocrText,
      shareCode: draft.shareCode,
      expectedGroupName: groupName,
      otherGroupNames: acceptedGroups.map((item) => item.groupName)
    });

    if (!verdict.valid) {
      await updateHashRow(reservedRow, { status: "rejected" });
      reservedRow = null;

      await saveSlot(draft.draftId, slot, groupName, analyzed, "rejected", verdict.reason, slotRows);

      return res.status(422).json({
        success: false,
        message: verdict.reason,
        slot: slotResponse(slot, groupName, "rejected", verdict.reason)
      });
    }

    await updateHashRow(reservedRow, { status: "accepted", expiresAt: "" });
    reservedRow = null;

    const acceptedReason = "Screenshot verified.";
    await saveSlot(draft.draftId, slot, groupName, analyzed, "accepted", acceptedReason, slotRows);

    return res.status(200).json({
      success: true,
      message: `${SLOT_LABELS[slot]} verified.`,
      slot: slotResponse(slot, groupName, "accepted", acceptedReason)
    });
  } catch (error) {
    if (reservedRow) {
      try {
        await updateHashRow(reservedRow, { status: "rejected" });
      } catch (cleanupError) {
        console.error("Unable to release screenshot reservation:", cleanupError);
      }
    }

    if (error instanceof ConfigError) {
      console.error("Screenshot verification configuration error:", error);
      return fail(res, 500, "Registration is temporarily unavailable. Please try again shortly.");
    }
    return serverError(res, "Screenshot verification failed:", error);
  }
}
