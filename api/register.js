import { verifyScreenshots, GeminiConfigError } from "./_lib/gemini.js";
import {
  ConfigError,
  appendMainRecord,
  countAttempts,
  evaluateTrackWindow,
  findDuplicateHashes,
  findTrack,
  recordHashes,
  getNextSequentialCode
} from "./_lib/sheets.js";
import { sendWelcomeEmail } from "./_lib/mailer.js"; // Adjust filename if your mailer is named differently (e.g., email.js)
import {
  ALL_IMAGE_KEYS,
  GROUP_IMAGE_KEYS,
  isValidEmail,
  normalizeImagesPayload,
  sha256,
  toSheetTimestamp
} from "./_lib/utils.js";

export const maxDuration = 60;

const GROUP_LABELS = {
  group1: "Group 1",
  group2: "Group 2",
  group3: "Group 3",
  group4: "Group 4",
  group5: "Group 5"
};

function fail(res, statusCode, payload) {
  return res.status(statusCode).json({ success: false, ...payload });
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, { message: "Method not allowed. Use POST." });
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};

  const trackName = String(body.track ?? "").trim();
  const fullName = String(body.fullName ?? body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  const validationErrors = [];
  if (!trackName) validationErrors.push("track is required.");
  if (!fullName || fullName.length < 3) validationErrors.push("fullName is required (minimum 3 characters).");
  if (!isValidEmail(email)) validationErrors.push("A valid email is required.");

  const { normalized: images, errors: imageErrors } = normalizeImagesPayload(body);
  for (const key of ALL_IMAGE_KEYS) {
    if (imageErrors[key]) validationErrors.push(imageErrors[key]);
  }
  if (!Object.keys(imageErrors).length) {
    const totalBytes = ALL_IMAGE_KEYS.reduce((sum, key) => sum + images[key].data.length, 0);
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

  const timestamp = toSheetTimestamp();

  try {
    const track = await findTrack(trackName);
    if (!track) {
      return fail(res, 404, { message: `Track "${trackName}" was not found.` });
    }

    const windowState = evaluateTrackWindow(track);
    if (!windowState.open) {
      return fail(res, 403, { message: windowState.reason });
    }

    const hashes = ALL_IMAGE_KEYS.map((key) => ({
      key,
      hash: sha256(images[key].data)
    }));

    const duplicates = await findDuplicateHashes(hashes.map((h) => h.hash));
    if (duplicates.length) {
      const duplicateKeys = duplicates
        .map((d) => hashes.find((h) => h.hash === d.hash)?.key)
        .filter(Boolean);
      const labels = duplicateKeys.map((k) => GROUP_LABELS[k] || "Status").join(", ");

      await appendMainRecord({
        timestamp,
        track: track.name || trackName,
        fullName,
        email,
        whatsapp: "",
        code: "",
        status: "Rejected",
        groupResults: GROUP_IMAGE_KEYS.map(() => "PENDING"),
        statusResult: "PENDING",
        aiNotes: `Duplicate screenshot(s) detected (${labels}). These image hashes already exist in the Hashes tab.`,
        attempt: (await countAttempts(email, track.name || trackName)) + 1,
        expires: ""
      });

      return fail(res, 409, {
        message:
          "Some of your screenshots have already been used by another registration. Please retake fresh screenshots.",
        duplicateImages: labels
      });
    }

    const verdict = await verifyScreenshots({ images, shareMessage: track.shareMessage });
    const attempt = (await countAttempts(email, track.name || trackName)) + 1;

    if (!verdict.approved) {
      await appendMainRecord({
        timestamp,
        track: track.name || trackName,
        fullName,
        email,
        whatsapp: "",
        code: "",
        status: "Rejected",
        groupResults: verdict.groupResults.map((g) => (g.valid ? "OK" : "FAIL")),
        statusResult: verdict.statusResult.valid ? "OK" : "FAIL",
        aiNotes: verdict.notes,
        attempt,
        expires: ""
      });

      return fail(res, 422, {
        message: "Screenshot verification failed. Please review the notes and try again.",
        notes: verdict.notes,
        groupResults: verdict.groupResults,
        statusResult: verdict.statusResult,
        attempt
      });
    }

    // 1. Generate the next sequential code automatically (e.g. 12000 -> 12013)
    const code = await getNextSequentialCode(track.codePrefix);

    const expires = track.codeExpiresAt ? toSheetTimestamp(track.codeExpiresAt) : "";

    // 2. Log record to Google Sheets
    await appendMainRecord({
      timestamp,
      track: track.name || trackName,
      fullName,
      email,
      whatsapp: "",
      code,
      status: "Approved",
      groupResults: verdict.groupResults.map(() => "OK"),
      statusResult: "OK",
      aiNotes: verdict.notes,
      attempt,
      expires
    });

    await recordHashes(hashes.map((h) => h.hash), email);

    // 3. Dispatch the automated welcome email with their unique training code[cite: 1, 2]
    try {
      await sendWelcomeEmail({
        email,
        fullName,
        track: track.name || trackName,
        code,
        expires
      });
    } catch (emailError) {
      console.error("Failed to dispatch confirmation email:", emailError);
      // We log the error but allow registration to succeed so the student still gets their code on screen
    }

    // 4. Return success response to frontend
    return res.status(200).json({
      success: true,
      message: "Registration approved. Keep your training code safe.",
      code,
      track: track.name || trackName,
      fullName,
      email,
      attempt,
      expires: expires || null
    });
  } catch (error) {
    if (error instanceof ConfigError || error instanceof GeminiConfigError) {
      return fail(res, 500, { message: error.message });
    }

    console.error("Registration failed:", error);
    return fail(res, 500, {
      message: "Unable to complete registration right now. Please try again shortly."
    });
  }
}