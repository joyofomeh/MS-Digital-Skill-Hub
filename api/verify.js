const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vTzxRHw92W7eSKtAaHkumg-joGwJa0wyv0CVShtZgECPvaS_w5cV0_NZaP1YmP67Jr0NdbLQ2T85zdN/pub?gid=0&single=true&output=csv";

function clean(value) {
  return value ? String(value).replace(/^["\s]+|["\r\n\s]+$/g, "") : "";
}

function parseCsvRows(csvText) {
  return String(csvText).split("\n").map((row) =>
    row.split(/,(?=(?:(?:[^"]*"){2})*[^"]*$)/)
  );
}

function findCertificate(csvText, certificateId) {
  const rows = parseCsvRows(csvText);
  const targetId = clean(certificateId).toLowerCase();

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowId = clean(row[0]).toLowerCase();
    if (rowId && rowId === targetId) {
      return {
        found: true,
        certificate: {
          certificateId: clean(row[0]),
          fullName: clean(row[1]),
          program: clean(row[2]),
          completionDate: clean(row[3]),
          dateOfIssue: clean(row[4]),
          status: clean(row[5]) || "Valid",
          verificationUrl: clean(row[6]),
          trainingLevel: clean(row[7])
        }
      };
    }
  }

  return { found: false };
}

export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  const certificateId = String(req.query.id || "").trim();

  if (!certificateId) {
    return res.status(400).json({
      success: false,
      message: "Certificate ID is required"
    });
  }

  try {
    const response = await fetch(SHEET_CSV_URL, {
      cache: "no-store",
      redirect: "follow"
    });

    if (!response.ok) {
      return res.status(502).json({
        success: false,
        message: "Unable to verify certificate at this time."
      });
    }

    const csvText = await response.text();
    const result = findCertificate(csvText, certificateId);
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to verify certificate at this time."
    });
  }
}
