import { randomUUID } from "node:crypto";
import {
  ConfigError,
  acquireLock,
  appendMainRecord,
  countAttempts,
  evaluateTrackWindow,
  findHashConflicts,
  findTrack,
  getHashRows,
  getNextSequentialCode,
  isEarliestReservation,
  reserveHashRow,
  updateHashRow
} from "./_lib/sheets.js";
import {
  ImageValidationError,
  analyzeImagePayload,
  isSimilarPHash
} from "./_lib/images.js";
import { sendWelcomeEmail } from "./_lib/mailer.js";
import { createSuccessToken } from "./_lib/tokens.js";
import { verifyLegacyText } from "./_lib/local-verify.js";
import { checkRateLimit, clientIpHash } from "./_lib/request-guard.js";
import {
  ALL_IMAGE_KEYS,
  GROUP_IMAGE_KEYS,
  isValidEmail,
  normalizeImagesPayload,
  sha256,
  sleep,
  toSheetTimestamp
} from "./_lib/utils.js";

export const maxDuration = 60;

const LABELS = {
  group1: "Group 1",
  group2: "Group 2",
  group3: "Group 3",
  group4: "Group 4",
  group5: "Group 5",
  status: "Status"
};

const RESERVATION_TTL_MS = 3 * 60 * 1000;

function fail(res, statusCode, payload) {
  return res.status(statusCode).json({ success: false, ...payload });
}

async function releaseReservations(reservations) {
  for (const reservation of reservations) {
    if (!reservation?.row || reservation.released) continue;
    try {
      await updateHashRow(reservation.row, { status: "rejected" });
      reservation.released = true;
    } catch (error) {
      console.error("Unable to release screenshot reservation:", error);
    }
  }
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, { message: "Method not allowed. Use POST." });
  }

  const ipLimit = checkRateLimit(
    `register:ip:${clientIpHash(req)}`,
    10,
    10 * 60 * 1000
  );
  if (!ipLimit.allowed) {
    res.setHeader("Retry-After", String(ipLimit.retryAfter));
    return fail(res, 429, {
      message: "Too many registration attempts. Please wait a few minutes and try again."
    });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const trackName = String(body.track ?? "").trim();
  const fullName = String(body.fullName ?? body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();
  const ocrTexts =
    body.ocrTexts && typeof body.ocrTexts === "object" && !Array.isArray(body.ocrTexts)
      ? body.ocrTexts
      : {};

  const validationErrors = [];
  if (!trackName) validationErrors.push("track is required.");
  if (!fullName || fullName.length < 3) {
    validationErrors.push("fullName is required (minimum 3 characters).");
  }
  if (!isValidEmail(email)) validationErrors.push("A valid email is required.");

  const { normalized: images, errors: imageErrors } = normalizeImagesPayload(body);
  for (const key of ALL_IMAGE_KEYS) {
    if (imageErrors[key]) validationErrors.push(imageErrors[key]);
  }

  if (!Object.keys(imageErrors).length) {
    const totalBytes = ALL_IMAGE_KEYS.reduce(
      (sum, key) => sum + images[key].data.length,
      0
    );
    if (totalBytes > 3_800_000) {
      validationErrors.push(
        "Combined screenshots exceed the 4.5MB serverless request limit. Please compress or resize the images and resubmit."
      );
    }
  }

  if (validationErrors.length) {
    return fail(res, 400, {
      message: "Validation failed. Please check your submission.",
      errors: validationErrors
    });
  }

  const emailLimit = checkRateLimit(
    `register:email:${sha256(email)}`,
    10,
    60 * 60 * 1000
  );
  if (!emailLimit.allowed) {
    res.setHeader("Retry-After", String(emailLimit.retryAfter));
    return fail(res, 429, {
      message: "This email has made too many registration attempts. Please try again later."
    });
  }

  let reservations = [];

  try {
    const analyzed = [];
    for (const key of ALL_IMAGE_KEYS) {
      const imageInfo = await analyzeImagePayload(images[key].data);
      if (imageInfo.lowInformation) {
        return fail(res, 422, {
          message: `${LABELS[key]} appears blank or too plain. Please upload a clear screenshot of the required WhatsApp screen.`
        });
      }
      analyzed.push({
        key,
        sha256: sha256(imageInfo.data),
        pHash: imageInfo.pHash
      });
    }

    const repeatedLabels = new Set();
    for (let left = 0; left < analyzed.length; left += 1) {
      for (let right = left + 1; right < analyzed.length; right += 1) {
        const a = analyzed[left];
        const b = analyzed[right];
        const exact = a.sha256 === b.sha256;
        const similar =
          !exact && a.pHash && b.pHash && isSimilarPHash(a.pHash, b.pHash);
        if (exact || similar) {
          repeatedLabels.add(LABELS[a.key]);
          repeatedLabels.add(LABELS[b.key]);
        }
      }
    }

    if (repeatedLabels.size) {
      const labels = [...repeatedLabels].join(", ");
      return fail(res, 409, {
        message:
          "You uploaded the same or too-similar screenshot more than once. Each of the 6 screenshots must be different.",
        duplicateImages: labels
      });
    }

    for (const item of analyzed) {
      const verdict = verifyLegacyText(ocrTexts[item.key]);
      if (!verdict.valid) {
        return fail(res, 422, {
          message: `${LABELS[item.key]} could not be verified. ${verdict.reason}`,
          errors: [`${LABELS[item.key]}: ${verdict.reason}`]
        });
      }
    }

    const track = await findTrack(trackName);
    if (!track) {
      return fail(res, 404, { message: `Track "${trackName}" was not found.` });
    }

    const windowState = evaluateTrackWindow(track);
    if (!windowState.open) {
      return fail(res, 403, { message: windowState.reason });
    }

    const submissionId = `single-${randomUUID()}`;
    for (const item of analyzed) {
      const reservation = await reserveHashRow({
        sha256: item.sha256,
        pHash: item.pHash,
        email,
        draftId: submissionId,
        slot: item.key,
        ttlMs: RESERVATION_TTL_MS
      });
      reservations.push({ ...reservation, item });
    }

    await sleep(350);

    const hashRows = await getHashRows();
    for (const reservation of reservations) {
      const conflicts = findHashConflicts(hashRows, {
        sha256: reservation.item.sha256,
        pHash: reservation.item.pHash,
        draftId: submissionId,
        slot: reservation.item.key
      });

      if (conflicts.length && !isEarliestReservation(reservation.info, conflicts)) {
        await releaseReservations(reservations);
        reservations = [];
        return fail(res, 409, {
          message:
            "Some of your screenshots have already been used by another registration. Please take fresh screenshots.",
          duplicateImages: LABELS[reservation.item.key]
        });
      }
    }

    const lock = await acquireLock(
      `sequence:${track.codePrefix}`,
      randomUUID(),
      15_000
    );

    if (!lock.acquired) {
      await releaseReservations(reservations);
      reservations = [];
      return fail(res, 429, {
        message: "Registration is busy right now. Please try again in a moment."
      });
    }

    let code = "";
    let attempt = 1;
    let expires = "";

    try {
      attempt = (await countAttempts(email, track.name || trackName)) + 1;
      code = await getNextSequentialCode(track.codePrefix);
      expires = track.codeExpiresAt ? toSheetTimestamp(track.codeExpiresAt) : "";

      await appendMainRecord({
        timestamp: toSheetTimestamp(),
        track: track.name || trackName,
        fullName,
        email,
        whatsapp: "",
        code,
        status: "Approved",
        groupResults: GROUP_IMAGE_KEYS.map(() => "OK"),
        statusResult: "OK",
        aiNotes: "Screenshots verified locally. Duplicate checks passed.",
        attempt,
        expires
      });
    } finally {
      await lock.release();
    }

    for (const reservation of reservations) {
      try {
        await updateHashRow(reservation.row, { status: "accepted" });
        reservation.released = true;
      } catch (error) {
        console.error("Unable to save accepted screenshot hash:", error);
      }
    }
    reservations = [];

    let emailSent = true;
    try {
      await sendWelcomeEmail({
        email,
        fullName,
        track: track.name || trackName,
        code,
        expires
      });
    } catch (mailError) {
      emailSent = false;
      console.error("Welcome email failed for", email, "-", mailError);
    }

    const successToken = createSuccessToken({ code, email });
    const redirectUrl = `/success.html?token=${encodeURIComponent(successToken)}`;

    return res.status(200).json({
      success: true,
      message: "Registration approved.",
      redirectUrl,
      attempt,
      emailSent,
      expires: expires || null
    });
  } catch (error) {
    await releaseReservations(reservations);

    if (error instanceof ConfigError) {
      console.error("Registration configuration error:", error);
      return fail(res, 500, {
        message: "Registration is temporarily unavailable. Please try again shortly."
      });
    }

    if (error instanceof ImageValidationError) {
      return fail(res, 422, { message: error.message });
    }

    console.error("Registration failed:", error);
    return fail(res, 500, {
      message: "Unable to complete registration right now. Please try again shortly."
    });
  }
}
