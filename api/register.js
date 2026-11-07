export const maxDuration = 10;

export default function handler(req, res) {
  res.setHeader("Allow", "POST");
  return res.status(410).json({
    success: false,
    message:
      "This registration endpoint has been replaced. Please reload the registration page and submit each screenshot separately."
  });
}
