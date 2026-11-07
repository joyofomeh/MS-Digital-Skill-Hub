import { randomUUID } from "node:crypto";
import {
  ConfigError,
  appendMainRecord,
  acquireLock,
  countAttempts,
  draftFromRow,
  evaluateTrackWindow,
  findHashConflicts,
  findMainRecordByCode,
  findTrack,
  getDraftRecord,
  getDraftSlotRecords,
  getDraftSlots,
  getHashRows,
  getMainRows,
  getNextSequentialCode,
  hashRowInfo,
  isEarliestReservation,
  updateDraft,
  updateHashRow,
  upsertDraftSlot
} from "./_lib/sheets.js";
import { sendWelcomeEmail } from "./_lib/mailer.js";
import { verifyDraftToken } from "./_lib/tokens.js";
import { ALL_IMAGE_KEYS, GROUP_IMAGE_KEYS, toSheetTimestamp } from "./_lib/utils.js";
import { checkRateLimit } from "./_lib/request-guard.js";
import {
  fail,
  publicDraft,
  serverError
} from "./_lib/registration.js";

export const maxDuration = 60;

const FINALIZE_LOCK_TTL_MS = 60 * 1000;
const CODE_LOCK_TTL_MS = 30 * 1000;

function readToken(req, body) {
  const authorization = String(req.headers?.authorization || "");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return String(body.token ?? "").trim();
}

function findSlotHashRow(hashRows, draftId, slot) {
  const matches = hashRows
    .map((row) => ({ row, info: hashRowInfo(row) }))
    .filter(({ info }) => info.draftId === draftId && info.slot === slot.slot);
  const accepted = matches.filter(({ info }) => info.status === "accepted");

  return (
    accepted.find(({ info }) => info.hash === slot.sha256)?.row ||
    accepted[accepted.length - 1]?.row ||
    matches[matches.length - 1]?.row ||
    null
  );
}

async function rejectSlot(draftId, slot, reason, hashRows, slotRows) {
  await upsertDraftSlot(
    draftId,
    slot.slot,
    {
      groupName: slot.groupName,
      sha256: slot.sha256,
      pHash: slot.pHash,
      status: "rejected",
      reason,
      mimeType: slot.mimeType,
      bytes: slot.bytes
    },
    slotRows
  );

  const row = findSlotHashRow(hashRows, draftId, slot);
  if (row) {
    await updateHashRow(row, { status: "rejected" });
  }
}

function validationFailure(res, draft, slots, reason) {
  return res.status(422).json({
    success: false,
    message: reason,
    draft: publicDraft({ ...draft, status: "draft", code: "" }, slots)
  });
}

async function deliverEmail({ draft, track, code, expires, row }) {
  const state = draftFromRow(row).emailState;

  if (state === "yes" || state === "sending") {
    await updateDraft(draft.draftId, { Status: "approved" }, row);
    return false;
  }

  await updateDraft(draft.draftId, { Status: "approved", "Email Sent": "sending" }, row);

  try {
    await sendWelcomeEmail({
      email: draft.email,
      fullName: draft.fullName,
      track: track.name || draft.track,
      code,
      expires
    });
    await updateDraft(draft.draftId, { "Email Sent": "yes" }, row);
    return true;
  } catch (mailError) {
    console.error("Welcome email failed for", draft.email, "-", mailError);
    await updateDraft(draft.draftId, { "Email Sent": "no" }, row);
    return false;
  }
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

  const finalizeLimit = checkRateLimit(
    `finalize:${claims.draftId}`,
    10,
    10 * 60 * 1000
  );
  if (!finalizeLimit.allowed) {
    res.setHeader("Retry-After", String(finalizeLimit.retryAfter));
    return fail(res, 429, "Too many finalize attempts. Please wait a few minutes and try again.");
  }

  let draftLock = null;
  let codeLock = null;

  try {
    const initialRecord = await getDraftRecord(claims.draftId);
    const initialDraft = initialRecord?.draft;

    if (!initialDraft || initialDraft.email.toLowerCase() !== claims.email) {
      return fail(res, 404, "Registration draft was not found. Please start again.");
    }

    if (initialDraft.status === "approved" && initialDraft.code) {
      const slots = await getDraftSlots(initialDraft.draftId);
      return res.status(200).json({
        success: true,
        alreadyFinalized: true,
        draft: publicDraft(initialDraft, slots)
      });
    }

    draftLock = await acquireLock(
      `draft:${initialDraft.draftId}`,
      randomUUID(),
      FINALIZE_LOCK_TTL_MS
    );
    if (!draftLock.acquired) {
      return fail(res, 409, "This registration is already being finalized. Please check its status in a moment.");
    }

    const record = await getDraftRecord(claims.draftId);
    const draft = record?.draft;
    if (!draft || draft.email.toLowerCase() !== claims.email) {
      return fail(res, 404, "Registration draft was not found. Please start again.");
    }

    if (draft.status === "approved" && draft.code) {
      const slots = await getDraftSlots(draft.draftId);
      return res.status(200).json({
        success: true,
        alreadyFinalized: true,
        draft: publicDraft(draft, slots)
      });
    }

    if (draft.status === "finalizing" && draft.code) {
      const mainRows = await getMainRows();
      const existingMain = await findMainRecordByCode(draft.code, mainRows);

      if (existingMain) {
        const track = await findTrack(draft.track);
        if (!track) {
          await updateDraft(draft.draftId, { Status: "approved" }, record.row);
        }
        const expires = track?.codeExpiresAt ? toSheetTimestamp(track.codeExpiresAt) : "";
        const emailSent = track
          ? await deliverEmail({ draft, track, code: draft.code, expires, row: record.row })
          : false;
        const slots = await getDraftSlots(draft.draftId);

        return res.status(200).json({
          success: true,
          alreadyFinalized: false,
          emailSent,
          draft: publicDraft(draftFromRow(record.row), slots)
        });
      }
    }

    const slotRecords = await getDraftSlotRecords(draft.draftId);
    let slots = slotRecords.infos;
    const slotRows = slotRecords.rows;
    const slotMap = new Map(slots.map((slot) => [slot.slot, slot]));
    const missing = ALL_IMAGE_KEYS.filter((key) => slotMap.get(key)?.status !== "accepted");

    if (missing.length) {
      if (draft.status === "finalizing") {
        await updateDraft(draft.draftId, { Status: "draft", Code: "" }, record.row);
      }
      return validationFailure(
        res,
        draftFromRow(record.row),
        slots,
        "Please upload all six screenshots before finalizing."
      );
    }

    const hashRows = await getHashRows();
    const invalidSlots = [];

    for (const key of ALL_IMAGE_KEYS) {
      if (invalidSlots.some((item) => item.slot.slot === key)) continue;

      const slot = slotMap.get(key);
      const ourRow = findSlotHashRow(hashRows, draft.draftId, slot);

      if (!ourRow || hashRowInfo(ourRow).hash !== slot.sha256) {
        invalidSlots.push({
          slot,
          reason: "The screenshot reservation is missing. Please replace this screenshot."
        });
        continue;
      }

      const ourInfo = hashRowInfo(ourRow);
      if (ourInfo.status !== "accepted") {
        invalidSlots.push({
          slot,
          reason: "This screenshot is no longer reserved. Please replace it."
        });
        continue;
      }

      const conflicts = findHashConflicts(hashRows, {
        sha256: slot.sha256,
        pHash: slot.pHash,
        draftId: draft.draftId,
        slot: key
      });

      if (conflicts.length && !isEarliestReservation(ourInfo, conflicts)) {
        const sameDraft = conflicts.some((item) => item.draftId === draft.draftId);
        invalidSlots.push({
          slot,
          reason: sameDraft
            ? "This screenshot is also used for another requirement in your registration. Please replace one of them."
            : "This screenshot has already been submitted by another registration. Please upload a fresh screenshot."
        });
      }
    }

    if (invalidSlots.length) {
      for (const item of invalidSlots) {
        await rejectSlot(draft.draftId, item.slot, item.reason, hashRows, slotRows);
      }

      if (draft.status === "finalizing") {
        await updateDraft(draft.draftId, { Status: "draft", Code: "" }, record.row);
      }
      const refreshedSlots = await getDraftSlots(draft.draftId);
      return validationFailure(
        res,
        draftFromRow(record.row),
        refreshedSlots,
        "Some screenshots could not be finalized. Please review the failed items and replace them."
      );
    }

    const track = await findTrack(draft.track);
    if (!track) {
      return fail(res, 404, "The selected track is no longer available.");
    }

    const windowState = evaluateTrackWindow(track);
    if (!windowState.open) {
      return fail(res, 403, windowState.reason);
    }

    const timestamp = toSheetTimestamp();
    const expires = track.codeExpiresAt ? toSheetTimestamp(track.codeExpiresAt) : "";

    let code = draft.code;

    codeLock = await acquireLock(
      `code:${track.codePrefix || track.name}`,
      randomUUID(),
      CODE_LOCK_TTL_MS
    );
    if (!codeLock.acquired) {
      return fail(res, 409, "Another registration is being finalized. Please try again in a moment.");
    }

    const mainRows = await getMainRows();

    if (!code) {
      code = await getNextSequentialCode(track.codePrefix, mainRows);
      await updateDraft(
        draft.draftId,
        { Status: "finalizing", Code: code, "Finalized At": timestamp },
        record.row
      );
    }

    const existingMain = await findMainRecordByCode(code, mainRows);
    if (!existingMain) {
      const attempt = (await countAttempts(draft.email, track.name || draft.track, mainRows)) + 1;
      await appendMainRecord({
        timestamp,
        track: track.name || draft.track,
        fullName: draft.fullName,
        email: draft.email,
        whatsapp: "",
        code,
        status: "Approved",
        groupResults: GROUP_IMAGE_KEYS.map(() => "OK"),
        statusResult: "OK",
        aiNotes: "All six required screenshots were uploaded and duplicate checks passed.",
        attempt,
        expires
      });
    }

    if (codeLock) {
      await codeLock.release();
      codeLock = null;
    }

    const emailSent = await deliverEmail({
      draft,
      track,
      code,
      expires,
      row: record.row
    });

    const approvedSlots = slots;

    return res.status(200).json({
      success: true,
      alreadyFinalized: false,
      emailSent,
      draft: publicDraft(draftFromRow(record.row), approvedSlots)
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("Registration finalize configuration error:", error);
      return fail(res, 500, "Registration is temporarily unavailable. Please try again shortly.");
    }
    return serverError(res, "Unable to finalize registration:", error);
  } finally {
    if (codeLock) {
      try {
        await codeLock.release();
      } catch (error) {
        console.error("Unable to release code lock:", error);
      }
    }
    if (draftLock) {
      try {
        await draftLock.release();
      } catch (error) {
        console.error("Unable to release draft lock:", error);
      }
    }
  }
}
