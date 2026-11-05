import { ConfigError, findApprovedRegistration } from "./_lib/sheets.js";
import { verifySuccessToken } from "./_lib/tokens.js";

function fail(res, statusCode, message) {
  return res.status(statusCode).json({ success: false, message });
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    return fail(res, 405, "Method not allowed. Use GET.");
  }

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
      return fail(res, 500, error.message);
    }

    console.error("Unable to load registration status:", error);
    return fail(res, 500, "Unable to load your registration right now. Please try again shortly.");
  }
}
