#!/usr/bin/env python3
"""
SAP ME2M Procurement Analyzer — sample headless Python worker.

This is a template. Replace with the actual production logic.
Receives input CSV/XLSX from the platform and writes an analyzed report
back to the reports directory, which the API then serves for download.
"""
import argparse
import json
import sys
import os
from datetime import datetime
import csv

REPORTS_DIR = os.environ.get("REPORTS_DIR", "./storage/reports")


def log(msg, level="INFO"):
    ts = datetime.utcnow().isoformat()
    print(f"[{ts}] [{level}] {msg}", flush=True)


def analyze(input_path, params):
    log(f"Starting ME2M analysis. Input: {input_path or '(none)'}")
    log(f"Parameters: {json.dumps(params)}")

    # --- Replace with real pandas / openpyxl analysis ---
    rows = []
    if input_path and os.path.exists(input_path):
        with open(input_path, "r", encoding="utf-8", errors="ignore") as f:
            reader = csv.reader(f)
            for i, row in enumerate(reader):
                if i < 5:
                    log(f"Sample row {i}: {row}")
                rows.append(row)
        log(f"Loaded {len(rows)} rows from input")
    else:
        log("No input file — running in demo mode")

    # Generate output report
    os.makedirs(REPORTS_DIR, exist_ok=True)
    ts = datetime.now().strftime("%Y%m%d_%H%M%S")
    out_path = os.path.join(REPORTS_DIR, f"me2m_report_{ts}.xlsx.csv")
    with open(out_path, "w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(["PO Number", "Vendor", "Material", "Qty", "Delivery Date", "Status", "Action"])
        writer.writerow(["4500012345", "VENDOR001", "MAT-001", "100", "2026-10-15", "On Track", "None"])
        writer.writerow(["4500012346", "VENDOR002", "MAT-002", "250", "2026-09-20", "Delayed", "Escalate"])
    log(f"Report written to: {out_path}")
    log("ME2M analysis complete.")
    return out_path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--params", default="{}")
    parser.add_argument("--input", default=None)
    args = parser.parse_args()

    try:
        params = json.loads(args.params)
    except json.JSONDecodeError:
        params = {}

    try:
        out = analyze(args.input, params)
        # Communicate result back via stdout — processor reads last JSON line
        print(json.dumps({"status": "ok", "output": out}), flush=True)
    except Exception as e:
        log(f"ERROR: {e}", "ERROR")
        print(json.dumps({"status": "error", "error": str(e)}), flush=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
