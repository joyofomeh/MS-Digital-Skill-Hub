import { randomUUID } from "node:crypto";
import {
  ConfigError,
  createDraft,
  evaluateTrackWindow,
  findTrack
} from "./_lib/sheets.js";
import { createDraftToken } from "./_lib/tokens.js";
import { isValidEmail, GROUP_IMAGE_KEYS, randomCode, sha256 } from "./_lib/utils.js";
import { fail, publicDraft, renderShareMessage, serverError } from "./_lib/registration.js";
import {
  checkRateLimit,
  clientIp,
  clientIpHash,
  verifyTurnstile
} from "./_lib/request-guard.js";

export const maxDuration = 30;

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return fail(res, 405, "Method not allowed. Use POST.");
  }

  res.setHeader("Cache-Control", "no-store");

  const ipLimit = checkRateLimit(
    `start:ip:${clientIpHash(req)}`,
    10,
    10 * 60 * 1000
  );
  if (!ipLimit.allowed) {
    res.setHeader("Retry-After", String(ipLimit.retryAfter));
    return fail(res, 429, "Too many registration attempts. Please wait a few minutes and try again.");
  }

  const body = req.body && typeof req.body === "object" ? req.body : {};
  const trackName = String(body.track ?? "").trim();
  const fullName = String(body.fullName ?? body.full_name ?? "").trim();
  const email = String(body.email ?? "").trim().toLowerCase();

  const errors = [];
  if (!trackName) errors.push("Track is required.");
  if (!fullName || fullName.length < 3) {
    errors.push("Full name is required (minimum 3 characters).");
  }
  if (!isValidEmail(email)) errors.push("A valid email address is required.");

  const rawGroupNames = Array.isArray(body.groupNames) ? body.groupNames : [];
  const groupNames = GROUP_IMAGE_KEYS.map((_, index) => {
    const name = String(rawGroupNames[index] ?? "").trim();
    if (name && (name.length < 2 || name.length > 120)) {
      errors.push(`Group ${index + 1} name must be between 2 and 120 characters.`);
    }
    return name;
  });

  if (errors.length) {
    return fail(res, 400, "Please check your details and try again.", { errors });
  }

  const emailLimit = checkRateLimit(
    `start:email:${sha256(email)}`,
    5,
    60 * 60 * 1000
  );
  if (!emailLimit.allowed) {
    res.setHeader("Retry-After", String(emailLimit.retryAfter));
    return fail(res, 429, "This email has made too many registration attempts. Please try again later.");
  }

  const turnstileToken = body.turnstileToken ?? body["cf-turnstile-response"];
  const turnstile = await verifyTurnstile(turnstileToken, clientIp(req));
  if (!turnstile.ok) {
    return fail(res, 403, "Security verification failed. Please refresh the page and try again.");
  }

  try {
    const track = await findTrack(trackName);
    if (!track) {
      return fail(res, 404, `Track "${trackName}" was not found.`);
    }

    const windowState = evaluateTrackWindow(track);
    if (!windowState.open) {
      return fail(res, 403, windowState.reason);
    }

    const draftId = randomUUID();
    const shareCode = `MSDSH-${randomCode(8)}`;
    const draft = await createDraft({
      draftId,
      fullName,
      email,
      track: track.name || trackName,
      groupNames,
      shareCode,
      shareMessage: renderShareMessage(track.shareMessage, shareCode)
    });

    const token = createDraftToken({ draftId, email });

    return res.status(200).json({
      success: true,
      token,
      draft: publicDraft(draft, [])
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("Registration start configuration error:", error);
      return fail(res, 500, "Registration is temporarily unavailable. Please try again shortly.");
    }
    return serverError(res, "Unable to start registration:", error);
  }
}
