import crypto from "node:crypto";
import {
  ConfigError,
  HASH_RETENTION_DAYS,
  cleanupExpiredHashRows
} from "./_lib/sheets.js";
import { sendCleanupAlert } from "./_lib/mailer.js";

export const maxDuration = 60;

async function alertCleanupIssue({ subject, summary, error }) {
  try {
    const sent = await sendCleanupAlert({ subject, summary, error });

    if (!sent) {
      console.warn(
        "Cleanup alert was not sent because mail settings are incomplete."
      );
    }
  } catch (alertError) {
    console.error("Unable to send cleanup alert:", alertError);
  }
}

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));

  if (leftBuffer.length !== rightBuffer.length) return false;

  return crypto.timingSafeEqual(leftBuffer, rightBuffer);
}

function isAuthorized(req) {
  const secret = String(process.env.CRON_SECRET || "").trim();

  if (!secret) {
    return { ok: false, configured: false };
  }

  const provided = String(req.headers.authorization || "");
  const expected = `Bearer ${secret}`;

  return { ok: safeEqual(provided, expected), configured: true };
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");

  if (req.method !== "GET" && req.method !== "POST") {
    res.setHeader("Allow", "GET, POST");
    return res.status(405).json({
      success: false,
      message: "Method not allowed. Use GET or POST."
    });
  }

  const authorization = isAuthorized(req);

  if (!authorization.configured) {
    console.error("Cleanup configuration error: CRON_SECRET is not set.");

    return res.status(503).json({
      success: false,
      message: "Cleanup is not configured."
    });
  }

  if (!authorization.ok) {
    return res.status(401).json({
      success: false,
      message: "Unauthorized."
    });
  }

  try {
    const result = await cleanupExpiredHashRows();

    console.log("Expired screenshot fingerprint cleanup completed:", result);

    if (result.deferred > 0) {
      await alertCleanupIssue({
        subject: "Screenshot cleanup deferred expired fingerprints",
        summary:
          `The cleanup run deferred ${result.deferred} expired fingerprint row(s) ` +
          `because the per-run limit was reached. Deleted ${result.deleted} row(s) ` +
          `and retained ${result.retained} row(s).`
      });
    }

    return res.status(200).json({
      success: true,
      retentionDays: HASH_RETENTION_DAYS,
      ...result
    });
  } catch (error) {
    if (error instanceof ConfigError) {
      console.error("Cleanup configuration error:", error);

      await alertCleanupIssue({
        subject: "Screenshot cleanup failed: configuration error",
        summary: "The scheduled screenshot fingerprint cleanup could not run.",
        error: error.message
      });

      return res.status(500).json({
        success: false,
        message: "Cleanup is temporarily unavailable."
      });
    }

    console.error("Expired screenshot fingerprint cleanup failed:", error);

    await alertCleanupIssue({
      subject: "Screenshot cleanup failed",
      summary: "The scheduled screenshot fingerprint cleanup failed and will retry on the next run.",
      error: error?.message || String(error)
    });

    return res.status(500).json({
      success: false,
      message: "Cleanup failed. It will be retried on the next scheduled run."
    });
  }
}
