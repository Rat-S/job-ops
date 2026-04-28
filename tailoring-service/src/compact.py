"""Convert master resume to compact format for prompts."""

from typing import Any


def convert_to_compact_format(resume: dict[str, Any]) -> str:
    """Convert JSON resume to compact markdown-like format."""
    lines = []
    
    # Basics
    basics = resume.get("basics", {})
    if basics:
        lines.append("## Basics")
        lines.append(f"Name: {basics.get('name', '')}")
        lines.append(f"Email: {basics.get('email', '')}")
        lines.append(f"Phone: {basics.get('phone', '')}")
        if basics.get("location"):
            loc = basics["location"]
            city = loc.get("city", "")
            country = loc.get("countryCode", "")
            if city or country:
                lines.append(f"Location: {city}, {country}")
        if basics.get("profiles"):
            lines.append("Profiles:")
            for profile in basics["profiles"]:
                network = profile.get("network", "")
                username = profile.get("username", "")
                if network and username:
                    lines.append(f"  - {network}: {username}")
        lines.append("")
    
    # Work Experience
    work = resume.get("work", [])
    if work:
        lines.append("## Work Experience")
        for entry in work:
            name = entry.get("name", "")
            position = entry.get("position", "")
            start = entry.get("startDate", "")
            end = entry.get("endDate", "Present")
            lines.append(f"{name} - {position} ({start} - {end})")
            
            # Include original summary/highlights for context
            summary = entry.get("summary", "")
            if summary:
                lines.append(f"  Summary: {summary}")
            highlights = entry.get("highlights", [])
            if highlights:
                lines.append("  Key achievements:")
                for h in highlights[:5]:  # Limit to 5
                    lines.append(f"    - {h}")
            lines.append("")
    
    # Education
    education = resume.get("education", [])
    if education:
        lines.append("## Education")
        for entry in education:
            institution = entry.get("institution", "")
            area = entry.get("area", "")
            study_type = entry.get("studyType", "")
            start = entry.get("startDate", "")
            end = entry.get("endDate", "")
            lines.append(f"{institution} - {area} ({study_type}) ({start} - {end})")
            
            courses = entry.get("courses", [])
            if courses:
                lines.append("  Relevant courses:")
                for c in courses[:3]:  # Limit to 3
                    lines.append(f"    - {c}")
            lines.append("")
    
    # Projects
    projects = resume.get("projects", [])
    if projects:
        lines.append("## Projects")
        for entry in projects:
            name = entry.get("name", "")
            start = entry.get("startDate", "")
            end = entry.get("endDate", "")
            description = entry.get("description", "")
            lines.append(f"{name} ({start} - {end})")
            if description:
                lines.append(f"  {description}")
            lines.append("")
    
    # Skills
    skills = resume.get("skills", [])
    if skills:
        lines.append("## Skills")
        for skill in skills:
            name = skill.get("name", "")
            keywords = skill.get("keywords", [])
            if name and keywords:
                lines.append(f"{name}: {', '.join(keywords[:10])}")  # Limit keywords
        lines.append("")
    
    # Certifications (from awards field)
    certifications = resume.get("certifications", []) or resume.get("awards", [])
    if certifications:
        lines.append("## Certifications")
        for cert in certifications:
            title = cert.get("title") or cert.get("name", "")
            issuer = cert.get("awarder") or cert.get("issuer", "")
            date = cert.get("date", "")
            lines.append(f"{title} - {issuer} ({date})")
        lines.append("")
    
    return "\n".join(lines)


def filter_resume_for_summary(resume: dict[str, Any]) -> dict[str, Any]:
    """Filter resume to basics + minimal context for summary call."""
    return {
        "basics": resume.get("basics", {}),
        "work": [{"name": w.get("name"), "position": w.get("position")} for w in resume.get("work", [])],
        "skills": resume.get("skills", []),
    }


def filter_resume_for_work(resume: dict[str, Any]) -> dict[str, Any]:
    """Filter resume to basics + work for work call."""
    return {
        "basics": resume.get("basics", {}),
        "work": resume.get("work", []),
    }


def filter_resume_for_supporting(resume: dict[str, Any]) -> dict[str, Any]:
    """Filter resume to education + projects + skills + certifications."""
    return {
        "basics": resume.get("basics", {}),
        "education": resume.get("education", []),
        "projects": resume.get("projects", []),
        "skills": resume.get("skills", []),
        "certifications": resume.get("certifications") or resume.get("awards", []),
    }
