import nodemailer from "nodemailer";

const TRAINING_DATES = {
  "Product Management": "30th November 2026",
  "Virtual Assistant": "14th December 2026"
};
const DEFAULT_TRAINING_DATE = "14th December 2026";

const SOCIAL_URLS = {
  linkedin: "https://www.linkedin.com/company/millionaires-squad/",
  twitter: "https://x.com/millionaresquad?s=21",
  facebook: "https://www.facebook.com/share/16LFzRyTrY/?mibextid=wwXIfr",
  tiktok: "https://www.tiktok.com/@millionaressquad?_t=ZM-8vHD1r115GR&_r=1"
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&#39;";
    }
  });
}

export async function sendWelcomeEmail({ email, fullName, track, code, expires }) {
  const transporter = nodemailer.createTransport({
    host: "smtp.zoho.com",
    port: 587,
    secure: false,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD
    }
  });

  const firstName = String(fullName ?? "").trim().split(/\s+/)[0] || "Learner";
  const trainingDate = TRAINING_DATES[track] || DEFAULT_TRAINING_DATE;

  const mailOptions = {
    from: '"MS Digital Skill Hub" <info@msdigitalskillhub.com.ng>',
    to: email,
    subject: `Your Unique Training Code - MS Digital Skill Hub (${code})`,
    html: `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>MS Digital Skill Hub - Registration Confirmation</title>
</head>

<body style="margin:0; padding:25px 10px; background-color:#f4f4f4; font-family:Arial,Helvetica,sans-serif; color:#ffffff;">

  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
    <tr>
      <td align="center">

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"
          style="max-width:600px; background-color:#171717; border-radius:12px; overflow:hidden;">

          <!-- Header -->
          <tr>
            <td style="padding:30px 28px 15px; text-align:center;">
              <h1 style="margin:0; color:#ffffff; font-size:23px;">
                MS Digital Skill Hub
              </h1>
              <p style="margin:8px 0 0; color:#d9a0b2; font-size:12px; letter-spacing:2px;">
                LEARN &amp; BECOME
              </p>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td style="padding:20px 28px; color:#eeeeee; font-size:14px; line-height:1.8;">

              <p>Hello <strong>${escapeHtml(firstName)}</strong>,</p>

              <p>
                Welcome to <strong style="color:#ffffff;">MS Digital Skill Hub!</strong>
                Your registration and WhatsApp shares have been successfully verified.
              </p>

              <p>
                We are pleased to officially confirm your registration for the
                <strong style="color:#ffffff;">${escapeHtml(track)} track!</strong>
              </p>

              <p>Your Unique Training Code (UTC) is:</p>

              <!-- Training Code -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center"
                    style="background-color:#321b25; border:1px solid #7A1F3D; border-radius:9px; padding:18px 10px;">
                    <span style="color:#e88aa9; font-size:21px; font-weight:bold; letter-spacing:1px;">
                      🪪 ${escapeHtml(code)}
                    </span>
                  </td>
                </tr>
              </table>

              <p>
                Please keep this ID safe, as it will be required throughout your
                training for attendance, weekly assessments, task submissions,
                progress tracking, and certificate processing.
              </p>

              <!-- Training Date -->
              <p style="color:#ffffff; font-weight:bold;">
                📅 Training commences on ${escapeHtml(trainingDate)}.
              </p>

              <p>
                We also want to sincerely thank you for sharing the training flyer
                and helping us grow our community. Your support goes a long way in
                helping others discover this opportunity and achieve their goals too!
              </p>

              <!-- Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td style="background-color:#301918; border:1px solid #7A1F3D;
                    border-radius:9px; padding:15px; color:#f0a0a0; font-size:13px; line-height:1.7;">

                    <strong>🚨 Important Security Notice:</strong><br>

                    Please note that MS Digital Skill Hub will never contact you
                    first via direct message asking for money, personal details,
                    passwords, OTPs, or verification fees.

                    If anyone reaches out to you claiming to be from our team
                    and requests these things, please block and report them instantly.

                  </td>
                </tr>
              </table>

              <!-- Social Media -->
              <p style="text-align:center; margin:28px 0 15px; color:#ffffff; font-weight:bold;">
                Follow our socials to stay updated:
              </p>

              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td align="center" style="padding:5px;">

                    <a href="${SOCIAL_URLS.linkedin}" style="display:inline-block; margin:4px; padding:9px 12px;
                      color:#e88aa9; border:1px solid #7A1F3D; border-radius:7px;
                      text-decoration:none; font-size:12px;">LinkedIn</a>

                    <a href="${SOCIAL_URLS.twitter}" style="display:inline-block; margin:4px; padding:9px 12px;
                      color:#e88aa9; border:1px solid #7A1F3D; border-radius:7px;
                      text-decoration:none; font-size:12px;">X (Twitter)</a>

                    <a href="${SOCIAL_URLS.facebook}" style="display:inline-block; margin:4px; padding:9px 12px;
                      color:#e88aa9; border:1px solid #7A1F3D; border-radius:7px;
                      text-decoration:none; font-size:12px;">Facebook</a>

                    <a href="${SOCIAL_URLS.tiktok}" style="display:inline-block; margin:4px; padding:9px 12px;
                      color:#e88aa9; border:1px solid #7A1F3D; border-radius:7px;
                      text-decoration:none; font-size:12px;">TikTok</a>

                  </td>
                </tr>
              </table>

              <!-- Signature -->
              <p style="margin-top:30px;">
                Warm regards,<br>
                <strong style="color:#ffffff; font-size:15px;">Joy Thomas</strong><br>
                <span style="color:#d9a0b2;">Founder &amp; Lead Instructor</span><br>
                <span style="color:#d9a0b2;">MS Digital Skill Hub</span>
              </p>

            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:20px 25px; border-top:1px solid #30252a; text-align:center;
              color:#999999; font-size:12px; line-height:1.8;">

              Have questions? Reach out to us at:<br>

              <a href="mailto:info@msdigitalskillhub.com.ng"
                style="color:#e88aa9; text-decoration:none;">
                info@msdigitalskillhub.com.ng
              </a>
              <br>

              Call/WhatsApp:
              <a href="https://wa.me/2347034794822"
                style="color:#e88aa9; text-decoration:none;">
                +2347034794822
              </a>

              <p style="margin:18px 0 0; font-size:11px; color:#777777;">
                Copyright © 2026 MS Digital Skill Hub. All rights reserved.
              </p>

            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>

</body>
</html>`
  };

  await transporter.sendMail(mailOptions);
}
