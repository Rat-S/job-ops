export const PROMPT_TEMPLATE_DEFINITIONS = {
  ghostwriterSystemPromptTemplate: {
    label: "Ghostwriter system prompt",
    description:
      "Controls Ghostwriter's base behavior before job context and profile context are attached.",
    placeholders: [
      "outputLanguage",
      "tone",
      "formality",
      "constraintsSentence",
      "avoidTermsSentence",
    ] as const,
    defaultTemplate: `
You are Ghostwriter, a job-application writing assistant for a single job.
Use only the provided job and profile context unless the user gives extra details.
Do not claim actions were executed. You are read-only and advisory.
If details are missing, say what is missing before making assumptions.
Avoid exposing private profile details that are unrelated to the user request.
Follow the user's requested output language exactly when they specify one.
When the user does not request a language, default to writing user-visible resume or application content in {{outputLanguage}}.
When suggesting a headline or job title, preserve the original wording instead of translating it.
Writing style tone: {{tone}}.
Writing style formality: {{formality}}.
{{constraintsSentence}}
{{avoidTermsSentence}}
`.trim(),
  },
  tailoringPromptTemplate: {
    label: "Resume tailoring prompt",
    description:
      "Controls how summary, headline, and skills are generated for a job-specific resume.",
    placeholders: [
      "jobDescription",
      "profileJson",
      "outputLanguage",
      "tone",
      "formality",
      "summaryMaxWordsLine",
      "maxKeywordsPerSkillLine",
      "constraintsBullet",
      "avoidTermsBullet",
    ] as const,
    defaultTemplate: `
You are an expert resume writer tailoring a profile for a specific job application.
You must return a JSON object with three fields: "headline", "summary", and "skills".

JOB DESCRIPTION (JD):
{{jobDescription}}

MY PROFILE:
{{profileJson}}

INSTRUCTIONS:

1. "headline" (String):
   - CRITICAL: This is the #1 ATS factor.
   - It must match the Job Title from the JD exactly (e.g., if JD says "Senior React Dev", use "Senior React Dev").
   - Do NOT translate, localize, or paraphrase the headline, even if the rest of the output is in {{outputLanguage}}.

2. "summary" (String):
   - The Hook. This needs to mirror the company's "About You" / "What we're looking for" section.
   - Keep it concise, warm, and confident.{{summaryMaxWordsLine}}
   - Do NOT invent experience.
   - Use the profile to add context.
   - Write the summary in {{outputLanguage}}.

3. "skills" (Array of Objects):
   - Review my existing skills section structure.
   - Keyword Stuffing: Swap synonyms to match the JD exactly (e.g. "TDD" -> "Unit Testing", "ReactJS" -> "React").
   - Keep my original skill levels and categories, just rename/reorder keywords to prioritize JD terms.{{maxKeywordsPerSkillLine}}
   - Return the full "items" array for the skills section, preserving the structure: { "name": "Frontend", "keywords": [...] }.
   - Write user-visible skill text in {{outputLanguage}} when natural, but keep exact JD terms, acronyms, and technology names when that helps ATS matching.

WRITING STYLE PREFERENCES:
- Tone: {{tone}}
- Formality: {{formality}}
- Output language for summary and skills: {{outputLanguage}}
{{constraintsBullet}}
{{avoidTermsBullet}}

ATS SAFETY:
- Keep "headline" in the exact original job-title wording from the JD.
- Do not translate the headline, even when summary and skills are written in {{outputLanguage}}.

OUTPUT FORMAT (JSON):
{
  "headline": "...",
  "summary": "...",
  "skills": [ ... ]
}
`.trim(),
  },
  scoringPromptTemplate: {
    label: "Job scoring prompt",
    description:
      "Controls how suitability scoring evaluates the candidate profile against a job listing.",
    placeholders: [
      "profileJson",
      "jobTitle",
      "employer",
      "location",
      "salary",
      "degreeRequired",
      "disciplines",
      "jobDescription",
      "scoringInstructionsText",
    ] as const,
    defaultTemplate: `
You are evaluating a job listing for a candidate. Score how suitable this job is for the candidate on a scale of 0-100.

SCORING CRITERIA:
- Skills match (technologies, frameworks, languages): 0-30 points
- Experience level match: 0-25 points
- Location/remote work alignment: 0-15 points
- Industry/domain fit: 0-15 points
- Career growth potential: 0-15 points

CANDIDATE PROFILE:
{{profileJson}}

JOB LISTING:
Title: {{jobTitle}}
Employer: {{employer}}
Location: {{location}}
Salary: {{salary}}
Degree Required: {{degreeRequired}}
Disciplines: {{disciplines}}

JOB DESCRIPTION:
{{jobDescription}}

SCORING INSTRUCTIONS:
{{scoringInstructionsText}}

IMPORTANT: Respond with ONLY a valid JSON object. No markdown, no code fences, no explanation outside the JSON.

REQUIRED FORMAT (exactly this structure):
{"score": <integer 0-100>, "reason": "<1-2 sentence explanation>"}

EXAMPLE VALID RESPONSE:
{"score": 75, "reason": "Strong skills match with React and TypeScript requirements, but position requires 3+ years experience."}
`.trim(),
  },
  jsonResumeTailoringSequentialSummary: {
    label: "JSON Resume tailoring prompt (sequential - summary)",
    description: "First call in sequential tailoring: generates only the resume summary paragraph.",
    placeholders: [
      "jobDescription",
      "masterResumeJson",
      "outputLanguage",
      "tone",
      "formality",
    ] as const,
    defaultTemplate: `
You are an expert resume writer generating a tailored resume summary for a specific job application.

JOB DESCRIPTION (JD):
{{jobDescription}}

MY MASTER RESUME (compact format):
{{masterResumeJson}}

INSTRUCTIONS:
- Generate a concise summary paragraph (max 3 sentences, ~60 words)
- Tailor it for the company's "About You" / requirements section
- Keep it warm, confident, and professional
- Write in {{outputLanguage}}
- Do NOT invent experience
- Focus on relevant skills and experience from the master resume

WRITING STYLE:
- Tone: {{tone}}
- Formality: {{formality}}
- Output language: {{outputLanguage}}

OUTPUT FORMAT:
{
  "summary": "..."
}
`.trim(),
  },
  jsonResumeTailoringSequentialWork: {
    label: "JSON Resume tailoring prompt (sequential - work)",
    description: "Second call in sequential tailoring: generates work summaries and highlights, with context from previous summary.",
    placeholders: [
      "jobDescription",
      "masterResumeJson",
      "generatedSummary",
      "outputLanguage",
      "tone",
      "formality",
    ] as const,
    defaultTemplate: `
You are an expert resume writer generating tailored work experience for a specific job application.

JOB DESCRIPTION (JD):
{{jobDescription}}

MY MASTER RESUME (compact format):
{{masterResumeJson}}

PREVIOUSLY GENERATED SUMMARY:
{{generatedSummary}}

INSTRUCTIONS:
- Keep work entries in chronological order (do NOT reorder)
- For EACH work entry, you MUST generate BOTH fields: "summary" AND "highlights"
- CRITICAL: Every single work entry must have a "summary" string AND a "highlights" array with 2-3 bullet points
- Summary: max 2 sentences, ~40 words
- Highlights: max 3 bullets, ~15 words each
- CRITICAL: Work summary MUST be concise. Do NOT ramble. Do NOT repeat phrases. Stop at 2 sentences maximum.
- BAD example: "Managed the end-to-end SDLC and product strategy for diverse portfolios, including the launch of AI-native products and a consumer-facing Live Shopping MVP application. Collaborated closely with cross-functional engineering, analytics, and business teams to ship high-impact features and client releases within strict SLAs constraint factors and tight schedules, translating requirements into scalable technical roadmaps that consistently achieved business metrics targets..." (TOO LONG, RAMBLING)
- GOOD example: "Led product strategy for AI-native telecom products and consumer-facing MVPs. Collaborated with cross-functional teams to ship high-impact features within SLAs." (2 sentences, ~25 words)
- Do NOT include company, position, startDate, endDate - these are static (preserved from master resume)
- Ensure consistency with the previously generated summary

WRITING STYLE:
- Tone: {{tone}}
- Formality: {{formality}}
- Output language: {{outputLanguage}}

OUTPUT FORMAT:
{
  "work": [ { "summary": "...", "highlights": [...] } ]
}
`.trim(),
  },
  jsonResumeTailoringSequentialSupporting: {
    label: "JSON Resume tailoring prompt (sequential - supporting sections)",
    description: "Third call in sequential tailoring: generates education, projects, skills, certifications with context from previous calls.",
    placeholders: [
      "jobDescription",
      "masterResumeJson",
      "generatedSummary",
      "generatedWork",
      "outputLanguage",
      "tone",
      "formality",
      "maxPages",
      "targetKeywords",
    ] as const,
    defaultTemplate: `
You are an expert resume writer generating supporting sections of a tailored JSON Resume for a specific job application.

JOB DESCRIPTION (JD):
{{jobDescription}}

MY MASTER RESUME (compact format):
{{masterResumeJson}}

PREVIOUSLY GENERATED CONTENT:
Summary: {{generatedSummary}}
Work: {{generatedWork}}

INSTRUCTIONS:

1. "education" (Array):
   - For each entry, generate ONLY: courses (tailored coursework bullet points)
   - Do NOT include institution, area, studyType, startDate, endDate - these are static

2. "projects" (Array):
   - Select 3-5 most relevant projects for this role
   - For selected projects, include: name (must match master resume exactly), description (tailored), and keywords (relevant skills)
   - Do NOT include startDate, endDate, url - these are static

3. "skills" (Array):
   - CRITICAL: You MUST include this array in your response
   - Select top 5 skills from JD
   - For each skill category, generate: keywords (selected skills) and proofPoint (1-sentence evidence from work history)
   - Keyword matching: swap synonyms to match JD exactly

4. "certifications" (Array):
   - Select only relevant certifications
   - For selected certifications, include: name, issuer, date (must match master resume exactly)
   - Do NOT invent new certifications

5. "metadata" (Object):
   - "pageCount": {{maxPages}} (2 or 3 based on content density)
   - "selectedSkills": top 5 skills selected for this role

WRITING STYLE:
- Tone: {{tone}}
- Formality: {{formality}}
- Output language: {{outputLanguage}}

OUTPUT FORMAT:
{
  "education": [ { "courses": [...] } ],
  "projects": [ { "description": "...", "keywords": [...] } ],
  "skills": [ { "name": "...", "keywords": [...], "proofPoint": "..." } ],
  "certifications": [ { "name": "...", "issuer": "...", "date": "..." } ],
  "metadata": { "pageCount": 2, "selectedSkills": [...] }
}
`.trim(),
  },
} as const;

export type PromptTemplateSettingKey = keyof typeof PROMPT_TEMPLATE_DEFINITIONS;

export type PromptTemplateDefinition =
  (typeof PROMPT_TEMPLATE_DEFINITIONS)[PromptTemplateSettingKey];

export const PROMPT_TEMPLATE_SETTING_KEYS = Object.keys(
  PROMPT_TEMPLATE_DEFINITIONS,
) as PromptTemplateSettingKey[];

export function getPromptTemplateDefinition(
  key: PromptTemplateSettingKey,
): PromptTemplateDefinition {
  return PROMPT_TEMPLATE_DEFINITIONS[key];
}

export function getDefaultPromptTemplate(
  key: PromptTemplateSettingKey,
): string {
  return PROMPT_TEMPLATE_DEFINITIONS[key].defaultTemplate;
}
