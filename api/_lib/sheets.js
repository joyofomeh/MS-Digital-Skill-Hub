import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { chunk, parseSheetDate } from "./utils.js";

let cachedDoc = null;

export class ConfigError extends Error {}

async function authorize() {
  const clientEmail = process.env.GOOGLE_SHEETS_CLIENT_EMAIL;
  const privateKeyRaw = process.env.GOOGLE_SHEETS_PRIVATE_KEY;
  const spreadsheetId = process.env.SPREADSHEET_ID;

  if (!clientEmail || !privateKeyRaw || !spreadsheetId) {
    throw new ConfigError(
      "Server is missing Google Sheets configuration (GOOGLE_SHEETS_CLIENT_EMAIL, GOOGLE_SHEETS_PRIVATE_KEY, SPREADSHEET_ID)."
    );
  }

  const privateKey = privateKeyRaw.includes("\\n")
    ? privateKeyRaw.replace(/\\n/g, "\n")
    : privateKeyRaw;

  if (cachedDoc) return cachedDoc;

  const serviceAccountAuth = new JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const doc = new GoogleSpreadsheet(spreadsheetId, serviceAccountAuth);
  await doc.loadInfo();
  cachedDoc = doc;
  return doc;
}

function getSheet(doc, title) {
  const sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    throw new ConfigError(`Google Sheet tab "${title}" was not found.`);
  }
  return sheet;
}

export async function getSpreadsheet() {
  return authorize();
}

function normalizeSwitch(value) {
  const v = String(value ?? "").trim().toLowerCase();
  if (["open", "yes", "true", "1", "on"].includes(v)) return "open";
  if (["closed", "close", "no", "false", "0", "off"].includes(v)) return "closed";
  return "auto";
}

export async function findTrack(trackName) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Tracks");
  
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const wanted = String(trackName || "").trim().toLowerCase();

  const row = rows.find((r) => {
    const name = String(r.get?.("Track name") ?? r["Track name"] ?? r["Track"] ?? "").trim().toLowerCase();
    const id = String(r.get?.("Track ID") ?? r["Track ID"] ?? "").trim().toLowerCase();
    return (wanted && name === wanted) || (wanted && id === wanted);
  });

  if (!row) return null;

  return {
    name: String(row.get?.("Track name") ?? row["Track name"] ?? row["Track"] ?? "").trim(),
    shareMessage: String(row.get?.("Share message") ?? row["Share message"] ?? "").trim(),
    codePrefix: String(row.get?.("Code prefix") ?? row["Code prefix"] ?? "").trim(),
    manualSwitch: normalizeSwitch(row.get?.("Manual switch") ?? row["Manual switch"]),
    opensAt: parseSheetDate(row.get?.("Open at") ?? row["Open at"]),
    closesAt: parseSheetDate(row.get?.("Close at") ?? row["Close at"], { endOfDay: true }),
    codeExpiresAt: parseSheetDate(row.get?.("Code expires at") ?? row["Code expires at"], { endOfDay: true })
  };
}

export function evaluateTrackWindow(track, now = new Date()) {
  if (track.manualSwitch === "closed") {
    return { open: false, reason: "Registration for this track has been closed by the organiser." };
  }
  if (track.manualSwitch === "open") {
    return { open: true, reason: "Opened manually by the organiser." };
  }

  if (track.opensAt && now < track.opensAt) {
    return {
      open: false,
      reason: `Registration for this track has not opened yet (opens ${track.opensAt.toISOString()}).`
    };
  }
  if (track.closesAt && now > track.closesAt) {
    return {
      open: false,
      reason: `Registration for this track closed on ${track.closesAt.toISOString()}.`
    };
  }
  return { open: true, reason: "Registration window is open." };
}

export async function findDuplicateHashes(hashes) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Hashes");
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const wanted = new Set(hashes.map((h) => h.toLowerCase()));
  const duplicates = [];

  for (const row of rows) {
    const hash = String(row.get?.("Hash") ?? row["Hash"] ?? "").trim().toLowerCase();
    if (wanted.has(hash)) {
      duplicates.push({
        hash,
        email: String(row.get?.("Email") ?? row["Email"] ?? "").trim(),
        timestamp: String(row.get?.("Timestamp") ?? row["Timestamp"] ?? "").trim()
      });
    }
  }

  return duplicates;
}

export async function recordHashes(hashes, email) {
  if (!hashes.length) return;
  const doc = await authorize();
  const sheet = getSheet(doc, "Hashes");
  await sheet.loadHeaderRow();
  const timestamp = new Date().toISOString();
  const payload = hashes.map((hash) => ({ Hash: hash, Timestamp: timestamp, Email: email }));

  for (const batch of chunk(payload, 200)) {
    await sheet.addRows(batch);
  }
}

export async function countAttempts(email, trackName) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const wantedEmail = String(email || "").trim().toLowerCase();
  const wantedTrack = String(trackName || "").trim().toLowerCase();

  return rows.filter((row) => {
    const rowEmail = String(row.get?.("Email") ?? row["Email"] ?? "").trim().toLowerCase();
    const rowTrack = String(row.get?.("Track") ?? row["Track"] ?? "").trim().toLowerCase();
    return rowEmail === wantedEmail && rowTrack === wantedTrack;
  }).length;
}

export async function existingCodes() {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();
  const codes = new Set();
  for (const row of rows) {
    const code = String(row.get?.("Code") ?? row["Code"] ?? "").trim();
    if (code) codes.add(code);
  }
  return codes;
}

export async function findApprovedRegistration(code, email) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  const wantedCode = String(code || "").trim();
  const wantedEmail = String(email || "").trim().toLowerCase();
  if (!wantedCode) return null;

  const row = rows.find((r) => {
    const rowCode = String(r.get?.("Code") ?? r["Code"] ?? "").trim();
    const rowEmail = String(r.get?.("Email") ?? r["Email"] ?? "").trim().toLowerCase();
    const rowStatus = String(r.get?.("Status") ?? r["Status"] ?? "").trim().toLowerCase();
    return (
      rowCode === wantedCode &&
      rowStatus === "approved" &&
      (!wantedEmail || rowEmail === wantedEmail)
    );
  });

  if (!row) return null;

  return {
    code: String(row.get?.("Code") ?? row["Code"] ?? "").trim(),
    fullName: String(row.get?.("Full Name") ?? row["Full Name"] ?? "").trim(),
    track: String(row.get?.("Track") ?? row["Track"] ?? "").trim()
  };
}

// Sequential Code Generator: finds the highest number already used for a prefix
// and increments it by 1. VA starts at 12000, PM starts at 11000.
const CODE_BASE_STARTS = {
  VA: 12000,
  PM: 11000
};
const DEFAULT_CODE_BASE = 10000;

function getCodeBase(prefix) {
  const parts = String(prefix || "").toUpperCase().split("/").filter(Boolean);
  for (const part of parts) {
    if (CODE_BASE_STARTS[part]) return CODE_BASE_STARTS[part];
  }
  return DEFAULT_CODE_BASE;
}

export async function getNextSequentialCode(codePrefix) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  await sheet.loadHeaderRow();
  const rows = await sheet.getRows();

  const prefix = String(codePrefix || "").trim().replace(/\/+$/, "");
  let nextVal = getCodeBase(prefix);

  for (const row of rows) {
    const code = String(row.get?.("Code") ?? row["Code"] ?? "").trim();
    if (!code.startsWith(`${prefix}/`)) continue;

    const parts = code.split("/");
    const lastPart = parseInt(parts[parts.length - 1], 10);
    if (!isNaN(lastPart)) {
      nextVal = Math.max(nextVal, lastPart + 1);
    }
  }

  return `${prefix}/${nextVal}`;
}

export async function appendMainRecord(record) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  await sheet.loadHeaderRow();
  await sheet.addRow({
    Timestamp: record.timestamp,
    Track: record.track,
    "Full Name": record.fullName,
    Email: record.email,
    WhatsApp: record.whatsapp,
    Code: record.code ?? "",
    Status: record.status,
    "Group 1": record.groupResults?.[0] ?? "",
    "Group 2": record.groupResults?.[1] ?? "",
    "Group 3": record.groupResults?.[2] ?? "",
    "Group 4": record.groupResults?.[3] ?? "",
    "Group 5": record.groupResults?.[4] ?? "",
    "Status OK": record.statusResult ?? "",
    "AI Notes": record.aiNotes ?? "",
    Attempt: record.attempt ?? "",
    Expires: record.expires ?? ""
  });
}