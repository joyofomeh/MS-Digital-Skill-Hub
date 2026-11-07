import os
import datetime
import hashlib
import time
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
import gspread
from google.oauth2.service_account import Credentials
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

app = Flask(__name__, template_folder='.')
CORS(app)

# ---------------------------------------------------------
# CONFIGURATION & TOGGLES
# ---------------------------------------------------------
REGISTRATION_OPEN = True

SPREADSHEET_ID = os.getenv("SPREADSHEET_ID", "").strip()
SERVICE_ACCOUNT_FILE = os.getenv("GOOGLE_APPLICATION_CREDENTIALS", "credentials.json")

TRACK_CODES = {
    "Virtual Assistant": "VA",
    "Product Management": "PM"
}

# Google Sheets Setup
SCOPES = [
    "https://www.googleapis.com/auth/spreadsheets",
    "https://www.googleapis.com/auth/drive"
]
try:
    credentials = Credentials.from_service_account_file(SERVICE_ACCOUNT_FILE, scopes=SCOPES)
    gc = gspread.authorize(credentials)
    sheet = gc.open_by_key(SPREADSHEET_ID).sheet1
    print("--> Google Sheets connected successfully!")
except Exception as e:
    print(f"--> Warning: Google Sheets authentication failed: {e}")
    sheet = None


def send_email_notification(to_email: str, subject: str, html_content: str):
    """Utility function to send any HTML email via Zoho Mail."""
    sender_email = os.getenv("MAIL_USERNAME")
    sender_password = os.getenv("MAIL_PASSWORD")
    
    if not sender_email or not sender_password:
        print("--> Email credentials not set in .env. Skipping email dispatch.")
        return False

    try:
        msg = MIMEMultipart('alternative')
        msg['From'] = f"MS Digital Skill Hub <{sender_email}>"
        msg['To'] = to_email
        msg['Subject'] = subject
        msg.attach(MIMEText(html_content, 'html'))

        server = smtplib.SMTP('smtp.zoho.com', 587)
        server.starttls()
        server.login(sender_email, sender_password)
        server.sendmail(sender_email, to_email, msg.as_string())
        server.quit()
        
        print(f"--> Email successfully sent via Zoho to {to_email}")
        return True
    except Exception as e:
        print(f"--> Failed to send email via Zoho: {e}")
        return False


def send_success_email(to_email: str, first_name: str, training_code: str, track: str):
    """Sends the branded HTML confirmation email with track details, logo, visual social icons, and safety warnings."""
    start_date = "30th November 2026" if track == "Product Management" else "14th December 2026"
    
    subject = f"Your Unique Training Code - MS Digital Skill Hub ({training_code})"
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: 'Poppins', Arial, sans-serif; background-color: #120e11; color: #ffffff; margin: 0; padding: 0; }}
            .email-container {{ max-width: 600px; margin: 20px auto; background-color: #1c161a; border-radius: 16px; border: 1px solid #2a2027; padding: 30px; }}
            .logo-container {{ text-align: center; margin-bottom: 25px; }}
            .logo-container img {{ max-width: 150px; height: auto; }}
            .content-box {{ font-size: 15px; line-height: 1.6; color: #e2e8f0; }}
            .code-box {{ background: #2d1822; border: 1px solid #4d2334; color: #e288a8; padding: 15px; text-align: center; border-radius: 12px; font-size: 20px; font-weight: bold; letter-spacing: 1px; margin: 20px 0; }}
            .security-box {{ background: #2d1818; border: 1px solid #522323; color: #e88888; padding: 15px; border-radius: 12px; margin: 20px 0; font-size: 14px; }}
            .socials-box {{ text-align: center; margin: 20px 0; padding: 15px; background: #221a20; border-radius: 12px; border: 1px solid #2a2027; }}
            .social-btn {{ display: inline-block; background: #2d1822; border: 1px solid #4d2334; color: #e288a8; text-decoration: none; padding: 8px 12px; margin: 5px; border-radius: 8px; font-weight: 600; font-size: 12px; }}
            .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #2a2027; text-align: center; font-size: 13px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="logo-container">
                <img src="https://msdigitalskillhub.com.ng/logo.jpg.png" alt="MS Digital Skill Hub Logo">
            </div>
            <div class="content-box">
                <p>Hello <strong>{first_name}</strong>,</p>
                <p>Welcome to <strong>MS Digital Skill Hub</strong>! Your registration and WhatsApp shares have been successfully verified.</p>
                
                <p>We are thrilled to officially confirm your registration for the <strong>{track}</strong> track!</p>
                
                <p>Your Unique Training Code (UTC) is:</p>
                <div class="code-box">🆔 {training_code}</div>
                
                <p>Please keep this ID safe, as it will be required throughout the training for attendance, weekly assessments, task submissions, progress tracking, and certificate processing.</p>
                
                <p>📅 <strong>Training commences on {start_date}.</strong></p>
                
                <p>We also want to sincerely <strong>thank you for sharing the training flyer</strong> and helping us grow our community. Your support goes a long way in helping others discover this opportunity and achieve their goals too!</p>
                
                <div class="security-box">
                    🚨 <strong>Important Security Notice:</strong><br>
                    Please note that <strong>MS Digital Skill Hub will never contact you first</strong> via direct message asking for money, personal details, or verification fees. If anyone reaches out to you claiming to be from our team, please <strong>block and report them instantly</strong>.
                </div>

                <p style="text-align: center; margin-top: 25px;"><strong>Follow our socials to stay updated:</strong></p>
                <div class="socials-box">
                    <a href="https://www.linkedin.com/company/millionaires-squad/" target="_blank" class="social-btn">🔗 LinkedIn</a>
                    <a href="https://x.com/millionaresquad?s=21" target="_blank" class="social-btn">𝕏 Twitter</a>
                    <a href="https://www.facebook.com/share/16LFzRyTrY/?mibextid=wwXIfr" target="_blank" class="social-btn">📘 Facebook</a>
                    <a href="https://www.tiktok.com/@millionaressquad?_t=ZM-8vHD1r115GR&_r=1" target="_blank" class="social-btn">🎵 TikTok</a>
                </div>
                
                <p style="margin-top: 25px;">
                    Warm regards,<br>
                    <strong>Joy Thomas</strong><br>
                    <span style="font-size: 13px; color: #94a3b8;">Founder & Lead Instructor</span><br>
                    <span style="font-size: 13px; color: #94a3b8;">MS Digital Skill Hub</span>
                </p>
            </div>
            <div class="footer">
                <p>Have any questions? Reach out to us at <a href="mailto:info@msdigitalskillhub.com.ng" style="color: #e288a8; text-decoration: none;">info@msdigitalskillhub.com.ng</a></p>
                <p style="margin: 8px 0;">Call/WhatsApp: <a href="tel:+2347043794822" style="color: #e288a8; text-decoration: none;">+2347043794822</a></p>
                <p style="font-size: 11px; color: #64748b; margin-top: 15px;">Copyright &copy; 2026 MS Digital Skill Hub. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """
    send_email_notification(to_email, subject, html_content)


def send_rejection_email(to_email: str, first_name: str, reason: str):
    """Sends a styled notification email when a submission is rejected due to duplicate screenshots."""
    subject = f"Registration Update - MS Digital Skill Hub Verification"
    html_content = f"""
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="UTF-8">
        <style>
            body {{ font-family: 'Poppins', Arial, sans-serif; background-color: #120e11; color: #ffffff; margin: 0; padding: 0; }}
            .email-container {{ max-width: 600px; margin: 20px auto; background-color: #1c161a; border-radius: 16px; border: 1px solid #2a2027; padding: 30px; }}
            .logo-container {{ text-align: center; margin-bottom: 25px; }}
            .logo-container img {{ max-width: 150px; height: auto; }}
            .content-box {{ font-size: 15px; line-height: 1.6; color: #e2e8f0; }}
            .reason-box {{ background: #2d1818; border: 1px solid #522323; color: #e88888; padding: 15px; border-radius: 12px; margin: 20px 0; }}
            .footer {{ margin-top: 30px; padding-top: 20px; border-top: 1px solid #2a2027; text-align: center; font-size: 13px; color: #94a3b8; }}
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="logo-container">
                <img src="https://msdigitalskillhub.com.ng/logo.jpg.png" alt="MS Digital Skill Hub Logo">
            </div>
            <div class="content-box">
                <p>Hello <strong>{first_name}</strong>,</p>
                <p>Thank you for applying to MS Digital Skill Hub. We have reviewed your submitted screenshots, but unfortunately, your submission could not be verified.</p>
                
                <div class="reason-box">
                    <strong>Reason for Rejection:</strong><br>{reason}
                </div>

                <p>Please re-submit your registration with 6 completely unique screenshots meeting all sharing requirements on our portal.</p>
                
                <p style="margin-top: 25px;">
                    Warm regards,<br>
                    <strong>Joy Thomas</strong><br>
                    <span style="font-size: 13px; color: #94a3b8;">Founder & Lead Instructor</span><br>
                    <span style="font-size: 13px; color: #94a3b8;">MS Digital Skill Hub</span>
                </p>
            </div>
            <div class="footer">
                <p>Have any questions? Reach out to us at <a href="mailto:info@msdigitalskillhub.com.ng" style="color: #e288a8; text-decoration: none;">info@msdigitalskillhub.com.ng</a></p>
                <p style="font-size: 11px; color: #64748b; margin-top: 15px;">Copyright &copy; 2026 MS Digital Skill Hub. All rights reserved.</p>
            </div>
        </div>
    </body>
    </html>
    """
    send_email_notification(to_email, subject, html_content)


def check_duplicate_uploads(image_bytes_list: list) -> bool:
    hashes = set()
    for img_bytes in image_bytes_list:
        img_hash = hashlib.sha256(img_bytes).hexdigest()
        if img_hash in hashes:
            return True
        hashes.add(img_hash)
    return False


def generate_training_code(track_name: str) -> str:
    track_code = TRACK_CODES.get(track_name, "VA")
    now = datetime.datetime.now()
    year_str = now.strftime("%y")
    
    sequence_num = 1
    if sheet:
        try:
            all_rows = sheet.get_all_values()
            sequence_num = max(1, len(all_rows))
        except Exception:
            pass

    if track_code == "VA":
        base_code = 12000 + sequence_num
    elif track_code == "PM":
        base_code = 11000 + sequence_num
    else:
        base_code = 10000 + sequence_num

    return f"MS/{track_code}/{year_str}/{base_code}"


@app.route('/')
@app.route('/register.html')
def serve_portal():
    return render_template('register.html')


@app.route('/api/register', methods=['POST'])
def handle_registration():
    print("\n--> New registration submission received!")
    if not REGISTRATION_OPEN:
        return jsonify({
            'success': False,
            'reason': 'Registration is currently closed. Please reach out to support.'
        }), 403

    try:
        name = (request.form.get('name') or '').strip()
        email = (request.form.get('email') or '').strip()
        track = (request.form.get('track') or '').strip()

        if not name or not email or not track:
            return jsonify({
                'success': False,
                'reason': 'Name, email and track are required.'
            }), 400

        group_bytes = []
        for i in range(1, 6):
            file = request.files.get(f'group_{i}')
            if not file or not file.filename:
                return jsonify({'success': False, 'reason': f'Missing screenshot for WhatsApp Group {i}.'}), 400
            data = file.read()
            if not data:
                return jsonify({'success': False, 'reason': f'Empty file for WhatsApp Group {i}.'}), 400
            group_bytes.append(data)

        status_file = request.files.get('status')
        if not status_file or not status_file.filename:
            return jsonify({'success': False, 'reason': 'Missing WhatsApp Status screenshot.'}), 400
        status_bytes = status_file.read()
        if not status_bytes:
            return jsonify({'success': False, 'reason': 'Empty WhatsApp Status screenshot.'}), 400

        first_name = name.split()[0] if name else "Learner"
        timestamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        # 1. Strict Duplicate Check
        all_uploads = group_bytes + [status_bytes]
        if check_duplicate_uploads(all_uploads):
            status = "REJECTED"
            training_code = "N/A"
            reason = "REJECTED: Duplicate screenshot detected. You must upload 6 unique screenshots (5 different group chats and 1 status share)."
            
            print(f"--> Duplicate screenshots detected for {email}. Rejecting submission.")
            send_rejection_email(email, first_name, reason)
            
            if sheet:
                try:
                    sheet.append_row([timestamp, name, email, track, status, training_code, reason])
                except Exception:
                    pass
            
            return jsonify({
                'success': False,
                'reason': 'Duplicate screenshot detected. Your submission has been rejected. Please check your email for details.'
            }), 400

        # 2. Simulate 10-second verification check
        print(f"--> Running 10-second verification check for {email}...")
        time.sleep(10)

        # 3. Generate Code & Send Success Email
        status = "SUCCESS"
        training_code = generate_training_code(track)
        reason = "Verification passed and registration successful."
        
        send_success_email(email, first_name, training_code, track)
        print(f"--> Verification complete! UTC {training_code} sent to {email}")

        # 4. Log Success to Google Sheets
        if sheet:
            try:
                sheet.append_row([timestamp, name, email, track, status, training_code, reason])
            except Exception:
                pass

        # 5. Return success response WITH the Unique Training Code displayed on screen
        return jsonify({
            'success': True,
            'confirmation_message': f"""REGISTRATION VERIFIED SUCCESSFULLY!

Dear {first_name},

Your WhatsApp shares have been verified for the {track} track.

Your Unique Training Code (UTC) is:
{training_code}

A copy of your code and welcome details has also been sent to your email ({email}).

Thank you for joining MS Digital Skill Hub!"""
        }), 200

    except Exception as e:
        app.logger.exception("Registration failed: %s", e)
        return jsonify({
            'success': False,
            'reason': f"Server Error: {str(e)}"
        }), 500

if __name__ == '__main__':
    app.run(port=5000, debug=True)