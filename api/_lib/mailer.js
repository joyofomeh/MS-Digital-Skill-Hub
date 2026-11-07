import nodemailer from "nodemailer";

const TRAINING_DATES = {
  "Product Management": "30th November 2026",
  "Virtual Assistance": "14th December 2026",
  "Virtual Assistant": "14th December 2026"
};
const DEFAULT_TRAINING_DATE = "14th December 2026";

const SOCIALS = [
  {
    name: "LinkedIn",
    url: "https://www.linkedin.com/company/millionaires-squad/",
    icon: "https://img.icons8.com/ios-filled/50/ffffff/linkedin.png"
  },
  {
    name: "X (Twitter)",
    url: "https://x.com/millionaresquad?s=21",
    icon: "https://img.icons8.com/ios-filled/50/ffffff/twitterx--v1.png"
  },
  {
    name: "Facebook",
    url: "https://www.facebook.com/share/16LFzRyTrY/?mibextid=wwXIfr",
    icon: "https://img.icons8.com/ios-filled/50/ffffff/facebook-f.png"
  },
  {
    name: "TikTok",
    url: "https://www.tiktok.com/@millionaressquad?_t=ZM-8vHD1r115GR&_r=1",
    icon: "https://img.icons8.com/ios-filled/50/ffffff/tiktok.png"
  }
];

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

function buildSocialIcons() {
  const cells = SOCIALS.map(
    (social) => `
                  <td align="center" bgcolor="#000000" style="background-color:#000000; padding:0 9px;">
                    <a href="${social.url}" target="_blank" rel="noopener noreferrer" style="display:inline-block; background-color:#000000; border-radius:50%; padding:10px; text-decoration:none;">
                      <img src="${social.icon}" alt="${social.name}" width="30" height="30" style="display:block; width:30px; height:30px; background-color:#000000; border:0; outline:none; text-decoration:none;" />
                    </a>
                  </td>`
  ).join("");

  return `
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000" style="background-color:#000000;">
                <tr>
                  <td align="center" bgcolor="#000000" style="background-color:#000000; padding:6px 0;">
                    <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000" style="background-color:#000000;">
                      <tr>${cells}
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>`;
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
<html lang="en" style="color-scheme:dark; supported-color-schemes:dark;">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>MS Digital Skill Hub - Registration Confirmation</title>
  <style>
    @media only screen and (max-width: 480px) {
      .email-pad { padding-left: 18px !important; padding-right: 18px !important; }
      .email-header { padding-top: 26px !important; padding-bottom: 20px !important; }
      .email-title { font-size: 21px !important; }
      .email-code { font-size: 22px !important; }
      .social-cell { padding: 0 6px !important; }
    }
  </style>
</head>

<body style="margin:0; padding:0; background-color:#000000; font-family:Arial,Helvetica,sans-serif; color:#FFFFFF;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000" style="background-color:#000000;">
    <tr>
      <td align="center" style="padding:28px 10px; background-color:#000000;">

        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000"
          style="max-width:600px; width:100%; background-color:#000000; border:1px solid #7A1F3D; border-radius:14px; overflow:hidden;">

          <!-- Logo Header -->
          <tr>
            <td class="email-header" align="center" bgcolor="#000000" style="padding:34px 28px 26px; background-color:#000000; text-align:center; border-bottom:1px solid #7A1F3D;">
              <table role="presentation" align="center" cellspacing="0" cellpadding="0" border="0" bgcolor="#000000" style="background-color:#000000; margin:0 auto;">
                <tr>
                  <td align="center" bgcolor="#000000" style="background-color:#000000; padding:0;">
                    <img
                      src="https://www.msdigitalskillhub.com.ng/assets/images/logo.jpg.png"
                      alt="MS Digital Skill Hub Logo"
                      width="160"
                      style="display:block; width:160px; max-width:100%; height:auto; margin:0 auto; background-color:#000000; border:0; outline:none; text-decoration:none;"
                    />
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Main Content -->
          <tr>
            <td class="email-pad" bgcolor="#000000" style="padding:28px 32px 8px; background-color:#000000; color:#FFFFFF; font-size:15px; line-height:1.8;">
              <p style="margin:0 0 18px; color:#FFFFFF; font-size:16px;">Hello <strong>${escapeHtml(firstName)}</strong>,</p>

              <p style="margin:0 0 18px; color:#FFFFFF; line-height:1.8;">
                Welcome to <strong style="color:#FFFFFF;">MS Digital Skill Hub!</strong>
                Your registration and WhatsApp shares have been successfully verified.
              </p>

              <p style="margin:0 0 18px; color:#FFFFFF; line-height:1.8;">
                We are pleased to officially confirm your registration for the
                <strong style="color:#FFFFFF;">${escapeHtml(track)} track!</strong>
              </p>

              <p style="margin:0 0 14px; color:#FFFFFF; line-height:1.8;">Your Unique Training Code (UTC) is:</p>

              <!-- Unique Training Code -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td align="center" bgcolor="#7A1F3D"
                    style="background-color:#7A1F3D; border:1px solid #A82A54; border-radius:10px; padding:24px 14px;">
                    <span class="email-code" style="display:block; color:#FFFFFF; font-family:'Courier New',Courier,monospace; font-size:25px; font-weight:bold; letter-spacing:2px; line-height:1.3;">
                      ${escapeHtml(code)}
                    </span>
                  </td>
                </tr>
              </table>

              <p style="margin:22px 0 18px; color:#FFFFFF; line-height:1.8;">
                Please keep this ID safe, as it will be required throughout your
                training for attendance, weekly assessments, task submissions,
                progress tracking, and certificate processing.
              </p>

              <p style="margin:0 0 18px; color:#FFFFFF; font-weight:bold; line-height:1.8;">
                Training commences on ${escapeHtml(trainingDate)}.
              </p>

              <p style="margin:0 0 22px; color:#FFFFFF; line-height:1.8;">
                We also want to sincerely thank you for sharing the training flyer
                and helping us grow our community. Your support goes a long way in
                helping others discover this opportunity and achieve their goals too!
              </p>

              <!-- Security Notice -->
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
                <tr>
                  <td bgcolor="#4A1124"
                    style="background-color:#4A1124; border:1px solid #7A1F3D; border-radius:10px; padding:16px; color:#FFFFFF; font-size:13px; line-height:1.7;">
                    <strong style="color:#FFFFFF;">🚨 Important Security Notice:</strong><br>

                    Please note that MS Digital Skill Hub will never contact you
                    first via direct message asking for money, personal details,
                    passwords, OTPs, or verification fees.

                    If anyone reaches out to you claiming to be from our team
                    and requests these things, please block and report them instantly.
                  </td>
                </tr>
              </table>

              <!-- Social Icons -->
              <p style="margin:28px 0 8px; color:#FFFFFF; font-weight:bold; text-align:center; font-size:14px;">
                Follow our socials to stay updated:
              </p>
              ${buildSocialIcons()}

              <!-- Signature -->
              <p style="margin:28px 0 0; color:#FFFFFF; line-height:1.8;">
                Warm regards,<br>
                <strong style="color:#FFFFFF; font-size:15px;">Joy Thomas</strong><br>
                <span style="color:#E0E0E0;">Founder &amp; Lead Instructor</span><br>
                <span style="color:#E0E0E0;">MS Digital Skill Hub</span>
              </p>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-pad" align="center" bgcolor="#000000"
              style="padding:22px 32px 26px; background-color:#000000; border-top:1px solid #7A1F3D; text-align:center; color:#E0E0E0; font-size:12px; line-height:1.8;">
              Have questions? Reach out to us at:<br>

              <a href="mailto:info@msdigitalskillhub.com.ng" style="color:#FFFFFF; text-decoration:underline;">
                info@msdigitalskillhub.com.ng
              </a>
              <br>

              Call/WhatsApp:
              <a href="https://wa.me/2347034794822" style="color:#FFFFFF; text-decoration:underline;">
                +2347034794822
              </a>

              <p style="margin:18px 0 0; font-size:11px; color:#E0E0E0;">
                Copyright &copy; 2026 MS Digital Skill Hub. All rights reserved.
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
