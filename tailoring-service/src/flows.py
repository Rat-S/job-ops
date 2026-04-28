"""Prefect flows for sequential resume tailoring."""

import json
import logging
from typing import Any

from prefect import flow, task
from prefect.tasks import task_input_hash

from cache import TailoringCache
from compact import (
    convert_to_compact_format,
    filter_resume_for_summary,
    filter_resume_for_supporting,
    filter_resume_for_work,
)
from llm_client import LLMClient
from prompts import summary_prompt, supporting_prompt, work_prompt
from schemas import SummaryOutput, SupportingOutput, WorkOutput, WritingStyle

# Initialize cache
cache = TailoringCache()

# Set up logger
logger = logging.getLogger("tailoring-service.flows")


@task(cache_key_fn=task_input_hash, retries=3, retry_delay_seconds=[2, 4, 8])
async def generate_summary(
    job_description: str,
    master_resume: dict[str, Any],
    writing_style: WritingStyle,
) -> str:
    """Generate tailored summary."""
    # Check cache first
    cached = cache.get(
        job_description,
        master_resume,
        writing_style.model_dump(),
        "summary",
    )
    if cached:
        return cached.get("summary", "")
    
    # Filter resume for this call
    filtered_resume = filter_resume_for_summary(master_resume)
    compact_resume = convert_to_compact_format(filtered_resume)
    
    # Generate prompt
    prompt = summary_prompt(
        job_description=job_description,
        master_resume_json=compact_resume,
        output_language=writing_style.manualLanguage,
        tone=writing_style.tone,
        formality=writing_style.formality,
    )
    
    # Log prompt details for debugging
    log_msg = f"Summary generation: job_desc_len={len(job_description)}, prompt_len={len(prompt)}"
    logger.info(log_msg)
    print(f"[FLOWS] {log_msg}", flush=True)
    
    # Call LLM
    client = LLMClient()
    result = await client.generate_structured(prompt, SummaryOutput)
    
    # Log the LLM output for debugging
    summary_text = result.summary if hasattr(result, 'summary') else str(result)
    log_msg = f"LLM generated summary: {summary_text[:100]}..."
    logger.info(log_msg)
    print(f"[FLOWS] {log_msg}", flush=True)
    print(f"[FLOWS] FULL SUMMARY: {summary_text}", flush=True)
    
    # Cache result
    cache.set(
        job_description,
        master_resume,
        writing_style.model_dump(),
        "summary",
        {"summary": result.summary},
    )
    
    return result.summary


@task(cache_key_fn=task_input_hash, retries=3, retry_delay_seconds=[2, 4, 8])
async def generate_work(
    job_description: str,
    master_resume: dict[str, Any],
    writing_style: WritingStyle,
    generated_summary: str,
) -> list[dict[str, Any]]:
    """Generate tailored work experience."""
    # Check cache first
    cached = cache.get(
        job_description,
        master_resume,
        writing_style.model_dump(),
        "work",
    )
    if cached:
        return cached.get("work", [])
    
    # Filter resume for this call
    filtered_resume = filter_resume_for_work(master_resume)
    compact_resume = convert_to_compact_format(filtered_resume)
    
    # Generate prompt
    prompt = work_prompt(
        job_description=job_description,
        master_resume_json=compact_resume,
        generated_summary=generated_summary,
        output_language=writing_style.manualLanguage,
        tone=writing_style.tone,
        formality=writing_style.formality,
    )
    
    # Call LLM
    client = LLMClient()
    result = await client.generate_structured(prompt, WorkOutput)
    
    # Log the LLM output for debugging
    work_entries = result.work if isinstance(result.work, list) else []
    logger.info(f"LLM generated work entries: {len(work_entries)} items")
    
    # Validate work entries
    valid_work = []
    for entry in work_entries:
        if isinstance(entry, dict) and "summary" in entry and "highlights" in entry:
            valid_work.append(entry)
    
    # Cache result
    cache.set(
        job_description,
        master_resume,
        writing_style.model_dump(),
        "work",
        {"work": valid_work},
    )
    
    return valid_work


@task(cache_key_fn=task_input_hash, retries=3, retry_delay_seconds=[2, 4, 8])
async def generate_supporting(
    job_description: str,
    master_resume: dict[str, Any],
    writing_style: WritingStyle,
    constraints: dict[str, Any],
    generated_summary: str,
    generated_work: list[dict[str, Any]],
) -> dict[str, Any]:
    """Generate tailored supporting sections."""
    # Check cache first
    cached = cache.get(
        job_description,
        master_resume,
        writing_style.model_dump(),
        "supporting",
    )
    if cached:
        return cached
    
    # Filter resume for this call
    filtered_resume = filter_resume_for_supporting(master_resume)
    compact_resume = convert_to_compact_format(filtered_resume)
    
    # Generate prompt
    prompt = supporting_prompt(
        job_description=job_description,
        master_resume_json=compact_resume,
        generated_summary=generated_summary,
        generated_work=json.dumps(generated_work),
        output_language=writing_style.manualLanguage,
        tone=writing_style.tone,
        formality=writing_style.formality,
        max_pages=constraints.get("maxPages", 2),
        target_keywords=", ".join(constraints.get("targetKeywords", [])),
    )
    
    # Call LLM
    client = LLMClient()
    result = await client.generate_structured(prompt, SupportingOutput)
    
    # Log the LLM output for debugging
    logger.info(f"LLM generated supporting: education={len(result.education) if result.education else 0}, projects={len(result.projects) if result.projects else 0}, skills={len(result.skills) if result.skills else 0}")
    
    # Build result dict
    output = {
        "education": result.education if result.education else [],
        "projects": result.projects if result.projects else [],
        "skills": result.skills if result.skills else [],
        "certifications": result.certifications if result.certifications else [],
        "metadata": result.metadata if result.metadata else {},
    }
    
    # Cache result
    cache.set(
        job_description,
        master_resume,
        writing_style.model_dump(),
        "supporting",
        output,
    )
    
    return output


@flow(name="tailor_resume", log_prints=True)
async def tailor_resume_flow(
    job_description: str,
    master_resume: dict[str, Any],
    writing_style: WritingStyle,
    constraints: dict[str, Any],
) -> dict[str, Any]:
    """Complete resume tailoring flow - 3 sequential LLM calls."""
    # Step 1: Generate summary
    summary = await generate_summary(
        job_description=job_description,
        master_resume=master_resume,
        writing_style=writing_style,
    )
    
    # Step 2: Generate work (with summary context)
    work = await generate_work(
        job_description=job_description,
        master_resume=master_resume,
        writing_style=writing_style,
        generated_summary=summary,
    )
    
    # Step 3: Generate supporting (with summary + work context)
    supporting = await generate_supporting(
        job_description=job_description,
        master_resume=master_resume,
        writing_style=writing_style,
        constraints=constraints,
        generated_summary=summary,
        generated_work=work,
    )
    
    # Convert Pydantic models to dicts for merging
    # Handle both Pydantic models (from LLM) and dicts (from cache)
    work_list = work.work if hasattr(work, 'work') else work if isinstance(work, list) else []
    work_dict = [w.model_dump() if hasattr(w, 'model_dump') else w for w in work_list]
    
    supporting_education = supporting.education if hasattr(supporting, 'education') else supporting.get('education') if isinstance(supporting, dict) else None
    supporting_projects = supporting.projects if hasattr(supporting, 'projects') else supporting.get('projects') if isinstance(supporting, dict) else None
    supporting_skills = supporting.skills if hasattr(supporting, 'skills') else supporting.get('skills') if isinstance(supporting, dict) else None
    supporting_certifications = supporting.certifications if hasattr(supporting, 'certifications') else supporting.get('certifications') if isinstance(supporting, dict) else None
    supporting_metadata = supporting.metadata if hasattr(supporting, 'metadata') else supporting.get('metadata') if isinstance(supporting, dict) else None
    
    supporting_dict = {
        "education": [e.model_dump() if hasattr(e, 'model_dump') else e for e in supporting_education] if supporting_education else None,
        "projects": [p.model_dump() if hasattr(p, 'model_dump') else p for p in supporting_projects] if supporting_projects else None,
        "skills": [s.model_dump() if hasattr(s, 'model_dump') else s for s in supporting_skills] if supporting_skills else None,
        "certifications": [c.model_dump() if hasattr(c, 'model_dump') else c for c in supporting_certifications] if supporting_certifications else None,
        "metadata": supporting_metadata.model_dump() if hasattr(supporting_metadata, 'model_dump') else supporting_metadata,
    }
    
    # Get summary string
    summary_str = summary.summary if hasattr(summary, 'summary') else summary if isinstance(summary, str) else ""
    
    # Merge with static master resume data
    tailored_resume = merge_with_static(master_resume, summary_str, work_dict, supporting_dict)
    
    # Log final result
    summary_preview = tailored_resume.get("summary", "")[:80] if tailored_resume.get("summary") else "(empty)"
    work_count = len(tailored_resume.get("work", []))
    logger.info(f"Tailoring complete: summary='{summary_preview}...', work_entries={work_count}")
    
    return tailored_resume


def merge_with_static(
    master_resume: dict[str, Any],
    summary: str,
    work: list[dict[str, Any]],
    supporting: dict[str, Any],
) -> dict[str, Any]:
    """Merge dynamic LLM output with static master resume data."""
    result = dict(master_resume)
    if "basics" in result and isinstance(result["basics"], dict):
        result["basics"] = dict(result["basics"])
        result["basics"]["summary"] = summary
    
    # Update summary
    result["summary"] = summary
    
    # Update work (preserve static fields, update dynamic)
    master_work = master_resume.get("work", [])
    if work and len(work) == len(master_work):
        new_work = []
        for master_entry, dynamic_entry in zip(master_work, work):
            entry = {
                **master_entry,
                "summary": dynamic_entry.get("summary", ""),
                "highlights": dynamic_entry.get("highlights", []),
            }
            if "company" in entry and "name" not in entry:
                entry["name"] = entry["company"]
            if str(entry.get("endDate", "")).lower() == "present":
                del entry["endDate"]
            new_work.append(entry)
        result["work"] = new_work
    
    # Update supporting sections
    if supporting.get("education"):
        master_education = master_resume.get("education", [])
        dynamic_education = supporting["education"]
        if len(dynamic_education) == len(master_education):
            result["education"] = [
                {
                    **master_entry,
                    "courses": dynamic_entry.get("courses", []),
                }
                for master_entry, dynamic_entry in zip(master_education, dynamic_education)
            ]
    
    if supporting.get("projects"):
        result["projects"] = supporting["projects"]
    
    if supporting.get("skills"):
        result["skills"] = supporting["skills"]
    
    if supporting.get("certifications"):
        result["certifications"] = supporting["certifications"]
    
    if supporting.get("metadata"):
        result["metadata"] = supporting["metadata"]
    
    return result
