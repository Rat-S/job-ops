import json
import re
from bs4 import BeautifulSoup
from datetime import datetime

def clean_html(raw_html):
    if not raw_html:
        return ""
    soup = BeautifulSoup(str(raw_html), "html.parser")
    return soup.get_text(separator=' ', strip=True)

def parse_date(date_str):
    if not date_str or date_str.lower() == "present":
        return date_str
    
    # Try parsing "Month YYYY"
    try:
        dt = datetime.strptime(date_str, "%B %Y")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        pass
    
    # Try parsing "YYYY"
    try:
        dt = datetime.strptime(date_str, "%Y")
        return dt.strftime("%Y-%m-%d")
    except ValueError:
        pass
        
    return date_str

def extract_dates(period_str):
    if not period_str:
        return "", ""
    parts = str(period_str).split(' - ')
    start = parse_date(parts[0].strip()) if len(parts) > 0 else ""
    end = parse_date(parts[1].strip()) if len(parts) > 1 else ""
    return start, end

def extract_highlights(html_str):
    if not html_str:
        return [], ""
    soup = BeautifulSoup(str(html_str), "html.parser")
    highlights = []
    
    # Extract all list items
    for li in soup.find_all('li'):
        highlights.append(li.get_text(strip=True))
        li.extract() # Remove the li so it doesn't end up in summary
    
    # The rest is the summary
    summary = soup.get_text(separator=' ', strip=True)
    return highlights, summary

def convert_rrv4_to_json_resume(input_path, output_path):
    with open(input_path, 'r') as f:
        rr = json.load(f)

    if "sections" not in rr:
        print("Not a Reactive Resume v4 file.")
        return

    json_resume = {
        "basics": rr.get("basics", {}),
        "work": [],
        "education": [],
        "skills": [],
        "projects": [],
        "awards": []
    }

    # Fix basics
    b = json_resume["basics"]
    if isinstance(b.get("location"), str):
        loc_str = b["location"]
        b["location"] = {
            "city": loc_str.split('|')[0].strip() if '|' in loc_str else loc_str,
            "countryCode": ""
        }
        
    url = ""
    if isinstance(b.get("website"), dict):
        url = b["website"].get("url", "")
        del b["website"] 
    elif "website" in b and not isinstance(b["website"], str):
        del b["website"]
        
    # Put linkedin in profiles
    if "profiles" not in b:
        b["profiles"] = []
    if url and "linkedin" in url.lower():
        b["profiles"].append({
            "network": "LinkedIn",
            "username": url.split('/')[-1] or url.split('/')[-2],
            "url": url
        })
    elif url:
        b["url"] = url

    sections = rr.get("sections", {})

    # Experience -> Work
    for item in sections.get("experience", {}).get("items", []):
        start_date, end_date = extract_dates(item.get("period", ""))
        highlights, summary = extract_highlights(item.get("description", ""))
        
        json_resume["work"].append({
            "name": item.get("company", ""),
            "position": item.get("position", ""),
            "url": item.get("website", {}).get("url", "") if isinstance(item.get("website"), dict) else "",
            "startDate": start_date,
            "endDate": end_date,
            "summary": summary,
            "highlights": highlights
        })

    # Education
    for item in sections.get("education", {}).get("items", []):
        start_date, end_date = extract_dates(item.get("period", "") or item.get("date", ""))
        desc = clean_html(item.get("summary", "") or item.get("description", ""))
        
        json_resume["education"].append({
            "institution": item.get("institution", ""),
            "area": item.get("area", ""),
            "studyType": item.get("degree", ""),
            "startDate": start_date,
            "endDate": end_date,
            "score": item.get("score", ""),
            "courses": []
        })

    # Skills
    for item in sections.get("skills", {}).get("items", []):
        json_resume["skills"].append({
            "name": item.get("name", ""),
            "level": item.get("level", ""),
            "keywords": item.get("keywords", [])
        })

    # Projects
    for item in sections.get("projects", {}).get("items", []):
        start_date, end_date = extract_dates(item.get("period", "") or item.get("date", ""))
        highlights, summary = extract_highlights(item.get("description", ""))
        
        json_resume["projects"].append({
            "name": item.get("name", ""),
            "description": summary,
            "highlights": highlights,
            "startDate": start_date,
            "endDate": end_date,
            "url": item.get("website", {}).get("url", "") if isinstance(item.get("website"), dict) else item.get("url", "")
        })

    # Certifications -> Awards
    cert_items = sections.get("certifications", {}).get("items", []) + sections.get("awards", {}).get("items", [])
    for item in cert_items:
        json_resume["awards"].append({
            "title": item.get("name", "") or item.get("title", ""),
            "date": "", # Removed date as requested
            "awarder": item.get("issuer", "") or item.get("awarder", ""),
            "summary": clean_html(item.get("summary", "")) or item.get("url", "")
        })

    with open(output_path, 'w') as f:
        json.dump(json_resume, f, indent=2)
    
    print(f"Successfully converted {input_path} to Standard JSON Resume at {output_path}")

if __name__ == "__main__":
    input_file = "/home/anu/Workspace/Job/Reference/inappropriate-aqua-warbler.json"
    output_file = "/home/anu/Workspace/Job/Reference/job-ops/data/master-resume.json"
    convert_rrv4_to_json_resume(input_file, output_file)
