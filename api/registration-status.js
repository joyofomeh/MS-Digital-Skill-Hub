import { ConfigError, findApprovedRegistration, getDraft, getDraftSlots } from "./_lib/sheets.js";
import { verifyDraftToken, verifySuccessToken } from "./_lib/tokens.js";
import { fail, publicDraft, serverError } from "./_lib/registration.js";

export const maxDuration = 20;

async function approvedRegistrationStatus(req, res) {
  const rawToken = req.query?.token;
  const token = Array.isArray(rawToken) ? rawToken[0] : rawToken;

  let payload;
  try {
    payload = verifySuccessToken(token);
  } catch (error) {
    console.error("Unable to verify success token:", error);
    return fail(res, 500, "Unable to verify this registration link right now.");
  }

  if (!payload) {
    return fail(res, 401, "This registration link is invalid or has expired.");
  }

  try {
    const registration = await findApprovedRegistration(payload.code, payload.email);
    if (!registration) {
      return fail(res, 403, "No approved registration was found for this link.");
    }

    return res.status(200).json({
      success: true,
      registration: {
        fullName: registration.fullName,
        code: registration.code,
        track: registration.track
      }
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("Registration status configuration error:", error);
      return fail(res, 500, "Registration is temporarily unavailable. Please try again shortly.");
    }

    console.error("Unable to load registration status:", error);
    return fail(res, 500, "Unable to load your registration right now. Please try again shortly.");
  }
}

function readToken(req, body) {
  const authorization = String(req.headers?.authorization || "");
  if (authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return String(body.token ?? "").trim();
}

async function draftRegistrationStatus(req, res) {
  const body = req.body && typeof req.body === "object" ? req.body : {};
  const claims = verifyDraftToken(readToken(req, body));
  if (!claims) {
    return fail(res, 401, "This registration session is invalid or has expired. Please start again.");
  }

  try {
    const draft = await getDraft(claims.draftId);
    if (!draft || draft.email.toLowerCase() !== claims.email) {
      return fail(res, 404, "Registration draft was not found. Please start again.");
    }

    const slots = await getDraftSlots(draft.draftId);

    return res.status(200).json({
      success: true,
      draft: publicDraft(draft, slots)
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("Registration status configuration error:", error);
      return fail(res, 500, "Registration is temporarily unavailable. Please try again shortly.");
    }
    return serverError(res, "Unable to load registration status:", error);
  }
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "GET") {
    return approvedRegistrationStatus(req, res);
  }

  if (req.method === "POST") {
    return draftRegistrationStatus(req, res);
  }

  res.setHeader("Allow", "GET, POST");
  return fail(res, 405, "Method not allowed.");
}
