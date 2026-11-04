import { GoogleSpreadsheet } from "google-spreadsheet";
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

  const doc = new GoogleSpreadsheet(spreadsheetId);
  await doc.useServiceAccountAuth({ client_email: clientEmail, private_key: privateKey });
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
  const rows = await sheet.getRows();
  const wanted = String(trackName || "").trim().toLowerCase();

  const row = rows.find((r) => {
    const name = String(r["Track name"] ?? r["Track"] ?? "").trim().toLowerCase();
    const id = String(r["Track ID"] ?? "").trim().toLowerCase();
    return (wanted && name === wanted) || (wanted && id === wanted);
  });

  if (!row) return null;

  return {
    name: String(row["Track name"] ?? row["Track"] ?? "").trim(),
    shareMessage: String(row["Share message"] ?? "").trim(),
    codePrefix: String(row["Code prefix"] ?? "").trim(),
    manualSwitch: normalizeSwitch(row["Manual switch"]),
    opensAt: parseSheetDate(row["Open at"]),
    closesAt: parseSheetDate(row["Close at"], { endOfDay: true }),
    codeExpiresAt: parseSheetDate(row["Code expires at"], { endOfDay: true })
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
  const rows = await sheet.getRows();
  const wanted = new Set(hashes.map((h) => h.toLowerCase()));
  const duplicates = [];

  for (const row of rows) {
    const hash = String(row["Hash"] ?? "").trim().toLowerCase();
    if (wanted.has(hash)) {
      duplicates.push({
        hash,
        email: String(row["Email"] ?? "").trim(),
        timestamp: String(row["Timestamp"] ?? "").trim()
      });
    }
  }

  return duplicates;
}

export async function recordHashes(hashes, email) {
  if (!hashes.length) return;
  const doc = await authorize();
  const sheet = getSheet(doc, "Hashes");
  const timestamp = new Date().toISOString();
  const payload = hashes.map((hash) => ({ Hash: hash, Timestamp: timestamp, Email: email }));

  for (const batch of chunk(payload, 200)) {
    await sheet.addRows(batch);
  }
}

export async function countAttempts(email, trackName) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  const rows = await sheet.getRows();
  const wantedEmail = String(email || "").trim().toLowerCase();
  const wantedTrack = String(trackName || "").trim().toLowerCase();

  return rows.filter((row) => {
    const rowEmail = String(row["Email"] ?? "").trim().toLowerCase();
    const rowTrack = String(row["Track"] ?? "").trim().toLowerCase();
    return rowEmail === wantedEmail && rowTrack === wantedTrack;
  }).length;
}

export async function existingCodes() {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  const rows = await sheet.getRows();
  const codes = new Set();
  for (const row of rows) {
    const code = String(row["Code"] ?? "").trim();
    if (code) codes.add(code);
  }
  return codes;
}

export async function appendMainRecord(record) {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
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
