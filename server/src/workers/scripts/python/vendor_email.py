#!/usr/bin/env python3
"""
Bulk Vendor Email Dispatcher — sample SMTP worker template.
Reads a recipient list, renders email templates, and sends via SMTP.
Replace SMTP logic with your production zimbra/smtp library.
"""
import argparse
import json
import os
import sys
import smtplib
from datetime import datetime
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText


def log(msg, level="INFO"):
    ts = datetime.utcnow().isoformat()
    print(f"[{ts}] [{level}] {msg}", flush=True)


def send_emails(input_path, params):
    log(f"Starting bulk email dispatch. Input: {input_path or '(none)'}")

    smtp_host = os.environ.get("SMTP_HOST", "smtp.company.com")
    smtp_port = int(os.environ.get("SMTP_PORT", "587"))
    smtp_user = os.environ.get("SMTP_USER", "")
    smtp_pass = os.environ.get("SMTP_PASS", "")

    template_subject = params.get("subject", "Follow-up on your open POs")
    template_body = params.get("body", "Dear {vendor},\n\nPlease update us on PO {po}.\n\nRegards,\nProcurement Team")

    # Demo recipients (replace with real Excel/CSV parsing via pandas/openpyxl)
    recipients = [
        {"vendor": "Acme Corp", "email": "acme@example.com", "po": "4500012345"},
        {"vendor": "Beta Industries", "email": "beta@example.com", "po": "4500012346"},
        {"vendor": "Gamma Supplies", "email": "gamma@example.com", "po": "4500012347"},
    ]

    log(f"SMTP server: {smtp_host}:{smtp_port}")
    log(f"Recipients queued: {len(recipients)}")

    sent = 0
    failed = 0

    # In production, open real SMTP connection here
    # server = smtplib.SMTP(smtp_host, smtp_port)
    # server.starttls(); server.login(smtp_user, smtp_pass)

    for i, r in enumerate(recipients, 1):
        try:
            body = template_body.format(vendor=r["vendor"], po=r["po"])
            msg = MIMEMultipart()
            msg["From"] = os.environ.get("SMTP_FROM", "automations@company.com")
            msg["To"] = r["email"]
            msg["Subject"] = template_subject
            msg.attach(MIMEText(body, "plain"))

            # server.send_message(msg)  # uncomment when SMTP is configured
            log(f"[{i}/{len(recipients)}] Sent to {r['email']} ({r['vendor']}) for PO {r['po']}")
            sent += 1
        except Exception as e:
            log(f"[{i}/{len(recipients)}] FAILED {r['email']}: {e}", "ERROR")
            failed += 1

    log(f"Dispatch complete. Sent={sent}, Failed={failed}")
    return {"sent": sent, "failed": failed}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--params", default="{}")
    parser.add_argument("--input", default=None)
    args = parser.parse_args()
    params = json.loads(args.params)

    try:
        result = send_emails(args.input, params)
        print(json.dumps({"status": "ok", **result}), flush=True)
    except Exception as e:
        log(f"ERROR: {e}", "ERROR")
        print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
