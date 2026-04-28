#!/usr/bin/env python3
"""Simple log viewer to convert JSONL logs to human-readable format."""

import json
import sys
from datetime import datetime
from pathlib import Path


def format_log_entry(entry: dict) -> str:
    """Format a single log entry for human reading."""
    lines = []
    lines.append("=" * 80)
    
    # Header
    timestamp = entry.get("_loggedAt") or entry.get("timestamp") or datetime.now().isoformat()
    lines.append(f"TIME: {timestamp}")
    
    entry_type = entry.get("type", "unknown")
    lines.append(f"TYPE: {entry_type}")
    
    if "jobId" in entry:
        lines.append(f"JOB ID: {entry['jobId']}")
    if "request_id" in entry:
        lines.append(f"REQUEST ID: {entry['request_id']}")
    
    lines.append("-" * 40)
    
    # Content based on type
    if entry_type == "python_service_response":
        lines.append("PYTHON SERVICE RESPONSE:")
        lines.append(f"  Success: {entry.get('success')}")
        lines.append(f"  Has Summary: {entry.get('hasSummary')}")
        lines.append("")
        lines.append("  SUMMARY PREVIEW:")
        summary = entry.get("summaryPreview", "(none)")
        lines.append(f"  {summary}")
        
        if entry.get("fullResponse"):
            lines.append("")
            lines.append("  FULL RESPONSE (keys):")
            response = entry.get("fullResponse", {})
            if isinstance(response, dict):
                lines.append(f"    {list(response.keys())}")
    
    elif entry_type == "db_save":
        lines.append("DATABASE SAVE:")
        lines.append(f"  Has tailoredResumeJson: {entry.get('hasTailoredResumeJson')}")
        lines.append("")
        lines.append("  SUMMARY TO SAVE:")
        summary = entry.get("summaryPreview", "(none)")
        lines.append(f"  {summary}")
    
    elif entry_type == "db_load":
        lines.append("DATABASE LOAD:")
        lines.append(f"  Has tailoredResumeJson: {entry.get('hasTailoredResumeJson')}")
        lines.append("")
        lines.append("  SUMMARY LOADED:")
        summary = entry.get("summaryPreview", "(none)")
        lines.append(f"  {summary}")
    
    else:
        # Generic display for unknown types
        for key, value in entry.items():
            if key not in ["_loggedAt", "timestamp", "type", "jobId", "request_id"]:
                if isinstance(value, str) and len(value) > 200:
                    lines.append(f"{key}: {value[:200]}...")
                else:
                    lines.append(f"{key}: {value}")
    
    lines.append("")
    return "\n".join(lines)


def view_log_file(filepath: str):
    """View a JSONL log file in human-readable format."""
    path = Path(filepath)
    if not path.exists():
        print(f"File not found: {filepath}")
        return
    
    print(f"\n{'=' * 80}")
    print(f"VIEWING: {filepath}")
    print(f"{'=' * 80}\n")
    
    with open(path) as f:
        for line_num, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
                print(f"ENTRY #{line_num}")
                print(format_log_entry(entry))
            except json.JSONDecodeError as e:
                print(f"ERROR on line {line_num}: {e}")
                print(f"  Raw: {line[:100]}")


def main():
    if len(sys.argv) < 2:
        # Find all log files in ./logs/
        log_dir = Path("./logs")
        if log_dir.exists():
            log_files = sorted(log_dir.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
            if log_files:
                print("Available log files:")
                for i, f in enumerate(log_files[:10], 1):
                    print(f"  {i}. {f.name}")
                print("\nUsage: python view_logs.py <log_file>")
                print(f"\nExample: python view_logs.py {log_files[0]}")
            else:
                print("No log files found in ./logs/")
        else:
            print("No ./logs/ directory found")
        return
    
    view_log_file(sys.argv[1])


if __name__ == "__main__":
    main()
