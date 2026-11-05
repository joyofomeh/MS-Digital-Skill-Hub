import nodemailer from "nodemailer";

export async function sendWelcomeEmail({ email, fullName, track, code, expires }) {
  const transporter = nodemailer.createTransport({
    host: process.env.MAIL_HOST || "smtp.zoho.com",
    port: Number(process.env.MAIL_PORT) || 465,
    secure: true,
    auth: {
      user: process.env.MAIL_USERNAME,
      pass: process.env.MAIL_PASSWORD
    }
  });

  const mailOptions = {
    from: '"MS Digital Skill Hub" <info@msdigitalskillhub.com.ng>',
    to: email,
    subject: `Your Unique Training Code - MS Digital Skill Hub (${code})`,
    html: `
      <div style="background-color: #121212; color: #ffffff; font-family: Arial, sans-serif; padding: 30px; border-radius: 8px;">
        <h2 style="color: #ffffff;">Hello ${fullName},</h2>
        <p>Welcome to MS Digital Skill Hub! Your registration and WhatsApp shares have been successfully verified.</p>
        <p>We are thrilled to officially confirm your registration for the <strong>${track}</strong> track!</p>
        <p>Your Unique Training Code (UTC) is:</p>
        
        <div style="background-color: #1e1e1e; border: 1px solid #333; padding: 20px; text-align: center; border-radius: 6px; margin: 20px 0;">
          <span style="font-size: 24px; font-weight: bold; color: #e91e63; letter-spacing: 2px;">ID ${code}</span>
        </div>

        <p>Please keep this ID safe, as it will be required throughout the training for attendance, weekly assessments, task submissions, progress tracking, and certificate processing.</p>
        <p><strong>Training commences on 14th December 2026.</strong></p>
        
        <hr style="border: 0; border-top: 1px solid #333; margin: 20px 0;" />
        <p style="font-size: 12px; color: #888;">
          <strong>Important Security Notice:</strong><br/>
          Please note that MS Digital Skill Hub will never contact you first via direct message asking for money, personal details, or verification fees. If anyone reaches out to you claiming to be from our team, please block and report them instantly.
        </p>

        <p style="margin-top: 30px;">Warm regards,<br/><strong>Joy Thomas</strong><br/>Founder & Lead Instructor<br/>MS Digital Skill Hub</p>
      </div>
    `
  };

  await transporter.sendMail(mailOptions);
}