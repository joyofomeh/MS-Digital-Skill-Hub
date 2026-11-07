import { GoogleSpreadsheet } from "google-spreadsheet";
import { JWT } from "google-auth-library";
import { chunk, parseSheetDate, sleep } from "./utils.js";

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

const MAIN_HEADERS = [
  "Timestamp",
  "Track",
  "Full Name",
  "Email",
  "WhatsApp",
  "Code",
  "Status",
  "Group 1",
  "Group 2",
  "Group 3",
  "Group 4",
  "Group 5",
  "Status OK",
  "AI Notes",
  "Attempt",
  "Expires"
];

const TRACK_HEADERS = [
  "Track name",
  "Share message",
  "Code prefix",
  "Manual switch",
  "Open at",
  "Close at",
  "Code expires at"
];

const HASH_HEADERS = ["Hash", "Timestamp", "Email"];

async function loadHeaderRowSafe(sheet, requiredHeaders) {
  let cachedHeaders = [];
  try {
    cachedHeaders = sheet.headerValues || [];
  } catch {
    cachedHeaders = [];
  }

  if (requiredHeaders.every((header) => cachedHeaders.includes(header))) {
    return;
  }

  try {
    await sheet.loadHeaderRow();
  } catch (error) {
    const duplicate = String(error?.message || "").match(/Duplicate header detected:\s*"([^"]+)"/i);
    if (!duplicate) throw error;

    console.warn(
      `Google Sheet tab "${sheet.title}" has duplicate header "${duplicate[1]}". ` +
      "Continuing with the existing header row; check that row 1 is correct."
    );
  }

  const headers = sheet.headerValues || [];
  const missing = requiredHeaders.filter((header) => !headers.includes(header));

  if (missing.length) {
    throw new ConfigError(
      `Google Sheet tab "${sheet.title}" is missing required header(s): ${missing.join(", ")}. ` +
      `Row 1 must contain: ${requiredHeaders.join(" | ")}.`
    );
  }
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

const trackCache = new Map();
const TRACK_CACHE_TTL_MS = 30 * 1000;

export async function findTrack(trackName) {
  const wanted = String(trackName || "").trim();
  const cacheKey = wanted.toLowerCase();
  const cached = trackCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const doc = await authorize();
  const sheet = getSheet(doc, "Tracks");

  await loadHeaderRowSafe(sheet, TRACK_HEADERS);
  const rows = await sheet.getRows();

  const row = rows.find((r) => {
    const name = String(r.get?.("Track name") ?? r["Track name"] ?? r["Track"] ?? "").trim().toLowerCase();
    const id = String(r.get?.("Track ID") ?? r["Track ID"] ?? "").trim().toLowerCase();
    return (cacheKey && name === cacheKey) || (cacheKey && id === cacheKey);
  });

  if (!row) {
    trackCache.set(cacheKey, { value: null, expiresAt: Date.now() + TRACK_CACHE_TTL_MS });
    return null;
  }

  const track = {
    name: String(row.get?.("Track name") ?? row["Track name"] ?? row["Track"] ?? "").trim(),
    shareMessage: String(row.get?.("Share message") ?? row["Share message"] ?? "").trim(),
    codePrefix: String(row.get?.("Code prefix") ?? row["Code prefix"] ?? "").trim(),
    manualSwitch: normalizeSwitch(row.get?.("Manual switch") ?? row["Manual switch"]),
    opensAt: parseSheetDate(row.get?.("Open at") ?? row["Open at"]),
    closesAt: parseSheetDate(row.get?.("Close at") ?? row["Close at"], { endOfDay: true }),
    codeExpiresAt: parseSheetDate(row.get?.("Code expires at") ?? row["Code expires at"], { endOfDay: true })
  };

  trackCache.set(cacheKey, { value: track, expiresAt: Date.now() + TRACK_CACHE_TTL_MS });
  return track;
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
  await loadHeaderRowSafe(sheet, HASH_HEADERS);
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
  await loadHeaderRowSafe(sheet, HASH_HEADERS);
  const timestamp = new Date().toISOString();
  const payload = hashes.map((hash) => ({ Hash: hash, Timestamp: timestamp, Email: email }));

  for (const batch of chunk(payload, 200)) {
    await sheet.addRows(batch);
  }
}

export async function countAttempts(email, trackName, mainRows = null) {
  const rows = mainRows || (await getMainRows());
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
  await loadHeaderRowSafe(sheet, MAIN_HEADERS);
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
  await loadHeaderRowSafe(sheet, MAIN_HEADERS);
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

export async function getMainRows() {
  const doc = await authorize();
  const sheet = getSheet(doc, "Main");
  await loadHeaderRowSafe(sheet, MAIN_HEADERS);
  return sheet.getRows();
}

export async function getNextSequentialCode(codePrefix, mainRows = null) {
  const rows = mainRows || (await getMainRows());

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
  await loadHeaderRowSafe(sheet, MAIN_HEADERS);
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
const DRAFT_HEADERS = [
  "Draft ID",
  "Created At",
  "Updated At",
  "Full Name",
  "Email",
  "Track",
  "Status",
  "Code",
  "Finalized At",
  "Email Sent",
  "Group 1 Name",
  "Group 2 Name",
  "Group 3 Name",
  "Group 4 Name",
  "Group 5 Name",
  "Share Code",
  "Share Message"
];

const SLOT_HEADERS = [
  "Draft ID",
  "Slot",
  "Group Name",
  "SHA256",
  "PHash",
  "Status",
  "Reason",
  "Mime Type",
  "Bytes",
  "Updated At"
];

const LOCK_HEADERS = ["Key", "Token", "Created At", "Expires At"];

const HASH_HEADERS_EXTENDED = [
  ...HASH_HEADERS,
  "PHash",
  "Slot",
  "Draft ID",
  "Status",
  "Expires At"
];

let workflowReady = false;

async function ensureHeadersExtended(sheet, headers) {
  let currentHeaders = [];
  try {
    currentHeaders = sheet.headerValues || [];
  } catch {
    currentHeaders = [];
  }

  if (!currentHeaders.length) {
    try {
      await sheet.loadHeaderRow();
    } catch (error) {
      const duplicate = String(error?.message || "").match(/Duplicate header detected:\s*"([^"]+)"/i);
      if (!duplicate) throw error;

      console.warn(
        `Google Sheet tab "${sheet.title}" has duplicate header "${duplicate[1]}". ` +
        "Continuing with the existing header row; check that row 1 is correct."
      );
    }

    try {
      currentHeaders = sheet.headerValues || [];
    } catch {
      currentHeaders = [];
    }
  }

  if (!currentHeaders.length) {
    await sheet.setHeaderRow(headers);
    return;
  }

  const missing = headers.filter((header) => !currentHeaders.includes(header));
  if (missing.length) {
    await sheet.setHeaderRow([...currentHeaders, ...missing]);
  }
  await loadHeaderRowSafe(sheet, headers);
}

async function ensureSheetWithHeaders(doc, title, headers) {
  let sheet = doc.sheetsByTitle[title];
  if (!sheet) {
    try {
      sheet = await doc.addSheet({ title, headerValues: headers });
    } catch {
      sheet = doc.sheetsByTitle[title];
    }
  }
  if (!sheet) {
    throw new ConfigError(`Google Sheet tab "${title}" could not be created.`);
  }
  await ensureHeadersExtended(sheet, headers);
  return sheet;
}

export async function ensureWorkflowSheets(doc) {
  if (workflowReady) return;

  await ensureSheetWithHeaders(doc, "Drafts", DRAFT_HEADERS);
  await ensureSheetWithHeaders(doc, "Draft Slots", SLOT_HEADERS);
  await ensureSheetWithHeaders(doc, "Locks", LOCK_HEADERS);

  const hashes = getSheet(doc, "Hashes");
  await ensureHeadersExtended(hashes, HASH_HEADERS_EXTENDED);

  workflowReady = true;
}

async function workflowDoc() {
  const doc = await authorize();
  await ensureWorkflowSheets(doc);
  return doc;
}

function cell(row, key) {
  return String(row?.get?.(key) ?? "").trim();
}

export function draftFromRow(row) {
  return {
    draftId: cell(row, "Draft ID"),
    createdAt: cell(row, "Created At"),
    updatedAt: cell(row, "Updated At"),
    fullName: cell(row, "Full Name"),
    email: cell(row, "Email"),
    track: cell(row, "Track"),
    status: cell(row, "Status"),
    code: cell(row, "Code"),
    finalizedAt: cell(row, "Finalized At"),
    emailSent: cell(row, "Email Sent") === "yes",
    emailState: cell(row, "Email Sent").toLowerCase(),
    groupNames: [1, 2, 3, 4, 5].map((index) => cell(row, `Group ${index} Name`)),
    shareCode: cell(row, "Share Code"),
    shareMessage: cell(row, "Share Message")
  };
}

async function findDraftRow(draftId) {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Drafts");
  const rows = await sheet.getRows();
  return rows.find((row) => cell(row, "Draft ID") === draftId) || null;
}

export async function getDraftRecord(draftId) {
  const row = await findDraftRow(draftId);
  return row ? { row, draft: draftFromRow(row) } : null;
}

export async function createDraft(draft) {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Drafts");
  const now = new Date().toISOString();
  const groupNames = Array.isArray(draft.groupNames) ? draft.groupNames : [];

  await sheet.addRow({
    "Draft ID": draft.draftId,
    "Created At": now,
    "Updated At": now,
    "Full Name": draft.fullName,
    Email: draft.email,
    Track: draft.track,
    Status: "draft",
    Code: "",
    "Finalized At": "",
    "Email Sent": "",
    "Group 1 Name": groupNames[0] || "",
    "Group 2 Name": groupNames[1] || "",
    "Group 3 Name": groupNames[2] || "",
    "Group 4 Name": groupNames[3] || "",
    "Group 5 Name": groupNames[4] || "",
    "Share Code": draft.shareCode || "",
    "Share Message": draft.shareMessage || ""
  });

  return {
    draftId: draft.draftId,
    createdAt: now,
    updatedAt: now,
    fullName: draft.fullName,
    email: draft.email,
    track: draft.track,
    status: "draft",
    code: "",
    finalizedAt: "",
    emailSent: false,
    emailState: "",
    groupNames,
    shareCode: draft.shareCode || "",
    shareMessage: draft.shareMessage || ""
  };
}

export async function getDraft(draftId) {
  const record = await getDraftRecord(draftId);
  return record ? record.draft : null;
}

export async function updateDraft(draftId, patch, existingRow = null) {
  const row = existingRow || (await findDraftRow(draftId));
  if (!row) return false;

  const next = { ...patch, "Updated At": new Date().toISOString() };
  row.assign(next);
  await row.save();
  return true;
}

function slotFromRow(row) {
  return {
    slot: cell(row, "Slot"),
    groupName: cell(row, "Group Name"),
    sha256: cell(row, "SHA256"),
    pHash: cell(row, "PHash"),
    status: cell(row, "Status"),
    reason: cell(row, "Reason"),
    mimeType: cell(row, "Mime Type"),
    bytes: Number(cell(row, "Bytes")) || 0,
    updatedAt: cell(row, "Updated At")
  };
}

export async function getDraftSlotRecords(draftId) {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Draft Slots");
  const rows = await sheet.getRows();
  const matching = rows.filter((row) => cell(row, "Draft ID") === draftId);
  return {
    rows: matching,
    infos: matching.map(slotFromRow)
  };
}

export async function getDraftSlots(draftId) {
  const records = await getDraftSlotRecords(draftId);
  return records.infos;
}

export async function getDraftSlot(draftId, slot) {
  const slots = await getDraftSlots(draftId);
  return slots.find((item) => item.slot === slot) || null;
}

export async function upsertDraftSlot(draftId, slot, data, existingRows = null) {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Draft Slots");
  const rows = existingRows || (await sheet.getRows());
  const existing = rows.find(
    (row) => cell(row, "Draft ID") === draftId && cell(row, "Slot") === slot
  );

  const payload = {
    "Group Name": data.groupName ?? "",
    SHA256: data.sha256 ?? "",
    PHash: data.pHash ?? "",
    Status: data.status ?? "",
    Reason: data.reason ?? "",
    "Mime Type": data.mimeType ?? "",
    Bytes: data.bytes ?? "",
    "Updated At": new Date().toISOString()
  };

  if (existing) {
    existing.assign(payload);
    await existing.save();
    return existing;
  }

  const row = await sheet.addRow({ "Draft ID": draftId, Slot: slot, ...payload });
  if (Array.isArray(existingRows)) existingRows.push(row);
  return row;
}

export async function getHashRows() {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Hashes");
  return sheet.getRows();
}

export function hashRowInfo(row) {
  return {
    hash: cell(row, "Hash"),
    pHash: cell(row, "PHash"),
    timestamp: cell(row, "Timestamp"),
    email: cell(row, "Email"),
    slot: cell(row, "Slot"),
    draftId: cell(row, "Draft ID"),
    status: cell(row, "Status").toLowerCase(),
    expiresAt: cell(row, "Expires At")
  };
}

function timestampMs(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function findHashConflicts(rows, candidate) {
  const now = Date.now();
  const conflicts = [];

  for (const row of rows) {
    const info = hashRowInfo(row);

    if (info.draftId === candidate.draftId && info.slot === candidate.slot) {
      continue;
    }

    if (
      info.status === "pending" &&
      info.expiresAt &&
      timestampMs(info.expiresAt) < now
    ) {
      continue;
    }

    const exact = info.hash && info.hash === candidate.sha256;

    if (exact) {
      conflicts.push({ ...info, type: "exact" });
    }
  }

  return conflicts;
}

export function isEarliestReservation(ourInfo, conflicts) {
  const candidates = [ourInfo, ...conflicts];
  candidates.sort((left, right) => {
    const timeDiff = timestampMs(left.timestamp) - timestampMs(right.timestamp);
    if (timeDiff !== 0) return timeDiff;
    return `${left.draftId}:${left.slot}`.localeCompare(`${right.draftId}:${right.slot}`);
  });
  return candidates[0] === ourInfo;
}

export async function reserveHashRow({ sha256, pHash, email, draftId, slot, ttlMs = 5 * 60 * 1000 }) {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Hashes");
  const now = new Date().toISOString();
  const expiresAt = new Date(Date.now() + ttlMs).toISOString();

  const row = await sheet.addRow({
    Hash: sha256,
    Timestamp: now,
    Email: email,
    PHash: pHash,
    Slot: slot,
    "Draft ID": draftId,
    Status: "pending",
    "Expires At": expiresAt
  });

  return { row, info: hashRowInfo(row) };
}

export async function updateHashRow(row, { status, expiresAt = "" }) {
  row.assign({ Status: status, "Expires At": expiresAt });
  await row.save();
}

export async function acquireLock(key, token, ttlMs = 60 * 1000) {
  const doc = await workflowDoc();
  const sheet = getSheet(doc, "Locks");
  const createdAt = new Date().toISOString();

  const row = await sheet.addRow({
    Key: key,
    Token: token,
    "Created At": createdAt,
    "Expires At": new Date(Date.now() + ttlMs).toISOString()
  });

  await sleep(200);

  const rows = await sheet.getRows();
  const active = rows.filter(
    (item) =>
      cell(item, "Key") === key && timestampMs(cell(item, "Expires At")) > Date.now()
  );
  active.sort((left, right) => {
    const timeDiff = timestampMs(cell(left, "Created At")) - timestampMs(cell(right, "Created At"));
    if (timeDiff !== 0) return timeDiff;
    return cell(left, "Token").localeCompare(cell(right, "Token"));
  });

  const acquired = active[0] && cell(active[0], "Token") === token;

  if (!acquired) {
    row.assign({ "Expires At": new Date(Date.now() - 1000).toISOString() });
    await row.save();
    return { acquired: false, release: async () => {} };
  }

  return {
    acquired: true,
    release: async () => {
      row.assign({ "Expires At": new Date(Date.now() - 1000).toISOString() });
      await row.save();
    }
  };
}

export async function findMainRecordByCode(code, mainRows = null) {
  const rows = mainRows || (await getMainRows());
  const row = rows.find((item) => cell(item, "Code") === code);
  return row || null;
}