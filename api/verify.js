export default async function handler(req, res) {
  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      message: "Method not allowed"
    });
  }

  const certificateId = req.query.id;

  if (!certificateId) {
    return res.status(400).json({
      success: false,
      message: "Certificate ID is required"
    });
  }

  const GOOGLE_SCRIPT_URL =
    "https://script.google.com/macros/s/AKfycbzgS6-9EqeHz4vIizi5tnJw6_mJYENDrsSgRhY2wCo7yEAsZslvruvMz4BoS_JUTJus/exec";

  try {
    const response = await fetch(
      `${GOOGLE_SCRIPT_URL}?id=${encodeURIComponent(certificateId)}`
    );

    const text = await response.text();

    let data;

    try {
      data = JSON.parse(text);
    } catch (error) {
      return res.status(502).json({
        success: false,
        message: "Invalid response from certificate registry."
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Unable to verify certificate at this time."
    });
  }
}