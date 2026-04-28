/**
 * Service for generating complete JSON Resume tailoring using LLM.
 * Replaces the limited summary/headline/skills generation with full resume structure.
 */

import { logger } from "@infra/logger";
import { LlmService } from "./llm/service";
import type { JsonSchemaDefinition } from "./llm/types";
import { createLlmLogEntry, logLlmCall } from "./llm-logging";
import { resolveLlmModel } from "./modelSelection";
import {
  getWritingLanguageLabel,
  resolveWritingOutputLanguage,
} from "./output-language";
import {
  getEffectivePromptTemplate,
  renderPromptTemplate,
} from "./prompt-templates";
import {
  getWritingStyle,
  stripKeywordLimitFromConstraints,
  stripLanguageDirectivesFromConstraints,
  stripWordLimitFromConstraints,
} from "./writing-style";

export interface JsonResumeTailoringInput {
  masterResumeJson: Record<string, unknown>;
  jobDescription: string;
  constraints?: {
    maxPages?: 2 | 3;
    targetKeywords?: string[];
  };
}

export interface JsonResumeTailoringOutput {
  tailoredResumeJson: Record<string, unknown>;
  metadata: {
    pageCount: number;
    selectedSkills: string[];
    proofPoints: Record<string, string>;
  };
}

export interface TailoringResult {
  success: boolean;
  data?: JsonResumeTailoringOutput;
  error?: string;
}

/** JSON schema for sequential tailoring - call 1: summary only */
const JSON_RESUME_TAILORING_SEQUENTIAL_SUMMARY_SCHEMA: JsonSchemaDefinition = {
  name: "json_resume_tailoring_sequential_summary",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph (max 3 sentences, ~60 words)",
      },
    },
    required: ["summary"],
    additionalProperties: false,
  },
};

/** JSON schema for sequential tailoring - call 2: work only */
const JSON_RESUME_TAILORING_SEQUENTIAL_WORK_SCHEMA: JsonSchemaDefinition = {
  name: "json_resume_tailoring_sequential_work",
  schema: {
    type: "object",
    properties: {
      work: {
        type: "array",
        description: "Work experience with tailored bullet points (company, position, dates are static from master resume)",
        items: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Job summary paragraph (max 2 sentences, ~40 words)" },
            highlights: {
              type: "array",
              items: { type: "string", description: "Tailored bullet points for this role (max 3 bullets, ~15 words each)" },
            },
          },
        },
      },
    },
    required: ["work"],
    additionalProperties: false,
  },
};

/** JSON schema for sequential tailoring - call 3: supporting sections */
const JSON_RESUME_TAILORING_SEQUENTIAL_SUPPORTING_SCHEMA: JsonSchemaDefinition = {
  name: "json_resume_tailoring_sequential_supporting",
  schema: {
    type: "object",
    properties: {
      education: {
        type: "array",
        description: "Education with tailored courses (institution, area, dates are static from master resume)",
        items: {
          type: "object",
          properties: {
            courses: {
              type: "array",
              items: { type: "string", description: "Tailored coursework bullet points" },
            },
          },
        },
      },
      projects: {
        type: "array",
        description: "Selected and tailored projects (names, dates are static from master resume)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Project name (must match master resume exactly)" },
            description: { type: "string", description: "Tailored project description" },
            keywords: {
              type: "array",
              items: { type: "string", description: "Relevant keywords for this project" },
            },
          },
        },
      },
      skills: {
        type: "array",
        description: "Selected skills with proof points",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill category name" },
            keywords: {
              type: "array",
              items: { type: "string", description: "Selected skills in this category" },
            },
            proofPoint: {
              type: "string",
              description: "1-sentence evidence demonstrating this skill from work history",
            },
          },
        },
      },
      certifications: {
        type: "array",
        description: "Selected certifications (name, issuer, date are static from master resume)",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Certification name (must match master resume exactly)" },
            issuer: { type: "string", description: "Issuer name (must match master resume exactly)" },
            date: { type: "string", description: "Certification date (must match master resume exactly)" },
          },
        },
      },
      metadata: {
        type: "object",
        properties: {
          pageCount: {
            type: "number",
            description: "Estimated page count (2 or 3)",
          },
          selectedSkills: {
            type: "array",
            items: { type: "string" },
            description: "Top 5 skills selected for this role",
          },
        },
      },
    },
    required: ["metadata"],
    additionalProperties: false,
  },
};

/**
 * Convert JSON resume data to compact markdown format for token efficiency.
 * This reduces token overhead from JSON syntax (~20-30% savings).
 */
function convertToCompactFormat(data: Record<string, unknown>): string {
  const lines: string[] = [];

  // Handle basics (static fields)
  if (data.basics && typeof data.basics === "object") {
    const basics = data.basics as Record<string, unknown>;
    lines.push("## Basics");
    if (basics.name) lines.push(`Name: ${basics.name}`);
    if (basics.email) lines.push(`Email: ${basics.email}`);
    if (basics.phone) lines.push(`Phone: ${basics.phone}`);
    if (basics.url) lines.push(`Website: ${basics.url}`);
    if (basics.location && typeof basics.location === "object") {
      const loc = basics.location as Record<string, unknown>;
      if (loc.city || loc.countryCode) {
        lines.push(`Location: ${[loc.city, loc.countryCode].filter(Boolean).join(", ")}`);
      }
    }
    if (basics.profiles && Array.isArray(basics.profiles)) {
      lines.push("Profiles:");
      (basics.profiles as Array<Record<string, unknown>>).forEach((p) => {
        if (p.network && p.username) {
          lines.push(`  - ${p.network}: ${p.username}`);
        }
      });
    }
    lines.push("");
  }

  // Handle summary
  if (data.summary && typeof data.summary === "string") {
    lines.push("## Summary");
    lines.push(data.summary);
    lines.push("");
  }

  // Handle work experience
  if (data.work && Array.isArray(data.work)) {
    lines.push("## Work Experience");
    (data.work as Array<Record<string, unknown>>).forEach((w) => {
      const parts = [];
      if (w.company) parts.push(w.company);
      if (w.position) parts.push(`- ${w.position}`);
      if (w.startDate || w.endDate) parts.push(`(${w.startDate} - ${w.endDate})`);
      lines.push(parts.join(" "));
      if (w.summary && typeof w.summary === "string") {
        lines.push(`  ${w.summary}`);
      }
      if (w.highlights && Array.isArray(w.highlights)) {
        (w.highlights as string[]).forEach((h) => {
          lines.push(`  - ${h}`);
        });
      }
      lines.push("");
    });
  }

  // Handle education
  if (data.education && Array.isArray(data.education)) {
    lines.push("## Education");
    (data.education as Array<Record<string, unknown>>).forEach((e) => {
      const parts = [];
      if (e.institution) parts.push(e.institution);
      if (e.area) parts.push(`- ${e.area}`);
      if (e.studyType) parts.push(`(${e.studyType})`);
      if (e.startDate || e.endDate) parts.push(`(${e.startDate} - ${e.endDate})`);
      lines.push(parts.join(" "));
      if (e.courses && Array.isArray(e.courses)) {
        lines.push("  Courses:");
        (e.courses as string[]).forEach((c) => {
          lines.push(`    - ${c}`);
        });
      }
      lines.push("");
    });
  }

  // Handle projects
  if (data.projects && Array.isArray(data.projects)) {
    lines.push("## Projects");
    (data.projects as Array<Record<string, unknown>>).forEach((p) => {
      const parts = [];
      if (p.name) parts.push(p.name);
      if (p.startDate || p.endDate) parts.push(`(${p.startDate} - ${p.endDate})`);
      lines.push(parts.join(" "));
      if (p.description && typeof p.description === "string") {
        lines.push(`  ${p.description}`);
      }
      if (p.keywords && Array.isArray(p.keywords)) {
        lines.push(`  Keywords: ${(p.keywords as string[]).join(", ")}`);
      }
      lines.push("");
    });
  }

  // Handle skills
  if (data.skills && Array.isArray(data.skills)) {
    lines.push("## Skills");
    (data.skills as Array<Record<string, unknown>>).forEach((s) => {
      const parts = [];
      if (s.name) parts.push(s.name);
      if (s.keywords && Array.isArray(s.keywords)) {
        parts.push(`: ${(s.keywords as string[]).join(", ")}`);
      }
      lines.push(parts.join(""));
    });
    lines.push("");
  }

  // Handle certifications (or awards - master resume uses awards)
  const certifications = (data.certifications || data.awards) as Array<Record<string, unknown>> | undefined;
  if (certifications && Array.isArray(certifications)) {
    lines.push("## Certifications");
    certifications.forEach((c) => {
      const parts = [];
      const name = c.name || c.title; // awards uses "title", certifications uses "name"
      const issuer = c.issuer || c.awarder; // awards uses "awarder", certifications uses "issuer"
      if (name) parts.push(name);
      if (issuer) parts.push(`- ${issuer}`);
      if (c.date) parts.push(`(${c.date})`);
      lines.push(parts.join(" "));
    });
  }

  return lines.join("\n");
}

/**
 * Generate complete tailored JSON Resume for a job using sequential LLM calls.
 * Uses 3 sequential calls with context propagation for improved reliability:
 * 1. Summary
 * 2. Work (with summary context)
 * 3. Supporting sections (with summary + work context)
 * Falls back to master resume data if any call fails.
 */
export async function generateJsonResumeTailoring(
  input: JsonResumeTailoringInput,
  context?: { jobId?: string; pipelineRunId?: string },
): Promise<TailoringResult> {
  const [model, writingStyle] = await Promise.all([
    resolveLlmModel("tailoring"),
    getWritingStyle(),
  ]);

  const llm = new LlmService();
  const startTime = Date.now();

  // Collect all dynamic data from sequential calls
  const dynamicData: Record<string, unknown> = {};
  let hasErrors = false;

  // Call 1: Generate summary
  try {
    const summaryTemplate = await getEffectivePromptTemplate("jsonResumeTailoringSequentialSummary");
    const summaryPrompt = renderPromptTemplate(
      summaryTemplate,
      {
        jobDescription: input.jobDescription,
        masterResumeJson: convertToCompactFormat(input.masterResumeJson),
        outputLanguage: writingStyle.manualLanguage,
        tone: writingStyle.tone,
        formality: writingStyle.formality,
      },
    );

    if (!JSON_RESUME_TAILORING_SEQUENTIAL_SUMMARY_SCHEMA || !JSON_RESUME_TAILORING_SEQUENTIAL_SUMMARY_SCHEMA.schema) {
      return { success: false, error: "Sequential summary schema is undefined" };
    }

    const summaryResult = await llm.callJson<Record<string, unknown>>({
      model,
      messages: [{ role: "user", content: summaryPrompt }],
      jsonSchema: JSON_RESUME_TAILORING_SEQUENTIAL_SUMMARY_SCHEMA,
    });

    await logLlmCall(
      createLlmLogEntry({
        model,
        context: {
          jobId: context?.jobId,
          pipelineRunId: context?.pipelineRunId,
          operation: "jsonResumeTailoring_sequential_summary",
        },
        request: {
          prompt: summaryPrompt,
          schema: JSON_RESUME_TAILORING_SEQUENTIAL_SUMMARY_SCHEMA,
          jobDescriptionLength: input.jobDescription.length,
          masterResumeSize: JSON.stringify(input.masterResumeJson).length,
        },
        response: {
          success: summaryResult.success,
          data: summaryResult.success ? summaryResult.data : undefined,
          error: summaryResult.success ? undefined : (summaryResult as any).error,
        },
        metadata: { duration: Date.now() - startTime },
      }),
    );

    if (summaryResult.success && summaryResult.data) {
      const data = summaryResult.data as { summary: string };
      if (typeof data.summary === 'string' && data.summary.trim().length > 0) {
        dynamicData.summary = data.summary;
      } else {
        logger.warn("Sequential summary returned invalid data, using master resume summary", {
          jobId: context?.jobId,
          data,
        });
        hasErrors = true;
      }
    } else {
      logger.warn("Sequential summary call failed, using master resume summary", {
        jobId: context?.jobId,
        error: (summaryResult as any).error,
      });
      hasErrors = true;
    }
  } catch (error) {
    logger.warn("Sequential summary call threw error, using master resume summary", {
      jobId: context?.jobId,
      error,
    });
    hasErrors = true;
  }

  // Call 2: Generate work (with summary context)
  try {
    const workTemplate = await getEffectivePromptTemplate("jsonResumeTailoringSequentialWork");
    // Filter master resume to only include work experience for this call
    const workOnlyResume = {
      basics: (input.masterResumeJson as Record<string, unknown>).basics,
      work: (input.masterResumeJson as Record<string, unknown>).work,
    };
    const workPrompt = renderPromptTemplate(
      workTemplate,
      {
        jobDescription: input.jobDescription,
        masterResumeJson: convertToCompactFormat(workOnlyResume),
        generatedSummary: dynamicData.summary as string || "",
        outputLanguage: writingStyle.manualLanguage,
        tone: writingStyle.tone,
        formality: writingStyle.formality,
      },
    );

    if (!JSON_RESUME_TAILORING_SEQUENTIAL_WORK_SCHEMA || !JSON_RESUME_TAILORING_SEQUENTIAL_WORK_SCHEMA.schema) {
      return { success: false, error: "Sequential work schema is undefined" };
    }

    const workResult = await llm.callJson<Record<string, unknown>>({
      model,
      messages: [{ role: "user", content: workPrompt }],
      jsonSchema: JSON_RESUME_TAILORING_SEQUENTIAL_WORK_SCHEMA,
    });

    await logLlmCall(
      createLlmLogEntry({
        model,
        context: {
          jobId: context?.jobId,
          pipelineRunId: context?.pipelineRunId,
          operation: "jsonResumeTailoring_sequential_work",
        },
        request: {
          prompt: workPrompt,
          schema: JSON_RESUME_TAILORING_SEQUENTIAL_WORK_SCHEMA,
          jobDescriptionLength: input.jobDescription.length,
          masterResumeSize: JSON.stringify(input.masterResumeJson).length,
        },
        response: {
          success: workResult.success,
          data: workResult.success ? workResult.data : undefined,
          error: workResult.success ? undefined : (workResult as any).error,
        },
        metadata: { duration: Date.now() - startTime },
      }),
    );

    if (workResult.success && workResult.data) {
      const data = workResult.data as { work?: unknown };
      if (Array.isArray(data.work) && data.work.length > 0) {
        // Validate each work entry has required fields
        const validWork = data.work.filter((entry: unknown) => {
          const w = entry as Record<string, unknown>;
          return typeof w.summary === 'string' && Array.isArray(w.highlights);
        });
        if (validWork.length > 0) {
          dynamicData.work = validWork;
        } else {
          logger.warn("Sequential work returned invalid structure, using master resume work", {
            jobId: context?.jobId,
            data,
          });
          hasErrors = true;
        }
      } else {
        logger.warn("Sequential work returned invalid data, using master resume work", {
          jobId: context?.jobId,
          data,
        });
        hasErrors = true;
      }
    } else {
      logger.warn("Sequential work call failed, using master resume work", {
        jobId: context?.jobId,
        error: (workResult as any).error,
      });
      hasErrors = true;
    }
  } catch (error) {
    logger.warn("Sequential work call threw error, using master resume work", {
      jobId: context?.jobId,
      error,
    });
    hasErrors = true;
  }

  // Call 3: Generate supporting sections (with summary + work context)
  try {
    const supportingTemplate = await getEffectivePromptTemplate("jsonResumeTailoringSequentialSupporting");
    // Filter master resume to only include relevant sections for this call
    const supportingOnlyResume = {
      basics: (input.masterResumeJson as Record<string, unknown>).basics,
      education: (input.masterResumeJson as Record<string, unknown>).education,
      projects: (input.masterResumeJson as Record<string, unknown>).projects,
      skills: (input.masterResumeJson as Record<string, unknown>).skills,
      certifications: (input.masterResumeJson as Record<string, unknown>).certifications,
    };
    const supportingPrompt = renderPromptTemplate(
      supportingTemplate,
      {
        jobDescription: input.jobDescription,
        masterResumeJson: convertToCompactFormat(supportingOnlyResume),
        generatedSummary: dynamicData.summary as string || "",
        generatedWork: JSON.stringify(dynamicData.work || []),
        outputLanguage: writingStyle.manualLanguage,
        tone: writingStyle.tone,
        formality: writingStyle.formality,
        maxPages: input.constraints?.maxPages ?? 2,
        targetKeywords: input.constraints?.targetKeywords?.join(", ") || "",
      },
    );

    if (!JSON_RESUME_TAILORING_SEQUENTIAL_SUPPORTING_SCHEMA || !JSON_RESUME_TAILORING_SEQUENTIAL_SUPPORTING_SCHEMA.schema) {
      return { success: false, error: "Sequential supporting schema is undefined" };
    }

    const supportingResult = await llm.callJson<Record<string, unknown>>({
      model,
      messages: [{ role: "user", content: supportingPrompt }],
      jsonSchema: JSON_RESUME_TAILORING_SEQUENTIAL_SUPPORTING_SCHEMA,
    });

    await logLlmCall(
      createLlmLogEntry({
        model,
        context: {
          jobId: context?.jobId,
          pipelineRunId: context?.pipelineRunId,
          operation: "jsonResumeTailoring_sequential_supporting",
        },
        request: {
          prompt: supportingPrompt,
          schema: JSON_RESUME_TAILORING_SEQUENTIAL_SUPPORTING_SCHEMA,
          jobDescriptionLength: input.jobDescription.length,
          masterResumeSize: JSON.stringify(input.masterResumeJson).length,
        },
        response: {
          success: supportingResult.success,
          data: supportingResult.success ? supportingResult.data : undefined,
          error: supportingResult.success ? undefined : (supportingResult as any).error,
        },
        metadata: { duration: Date.now() - startTime },
      }),
    );

    if (supportingResult.success && supportingResult.data) {
      const data = supportingResult.data as Record<string, unknown>;
      // Validate required fields exist
      const hasMetadata = data.metadata && typeof data.metadata === 'object';
      const hasSkills = Array.isArray(data.skills) && data.skills.length > 0;
      
      if (hasMetadata) {
        dynamicData.education = data.education;
        dynamicData.projects = data.projects;
        dynamicData.skills = data.skills;
        dynamicData.certifications = data.certifications;
        dynamicData.metadata = data.metadata;
        
        if (!hasSkills) {
          logger.warn("Sequential supporting call missing skills array, but continuing with other fields", {
            jobId: context?.jobId,
          });
          hasErrors = true;
        }
      } else {
        logger.warn("Sequential supporting call returned invalid structure (missing metadata), using master resume supporting sections", {
          jobId: context?.jobId,
          data,
        });
        hasErrors = true;
      }
    } else {
      logger.warn("Sequential supporting call failed, using master resume supporting sections", {
        jobId: context?.jobId,
        error: (supportingResult as any).error,
      });
      hasErrors = true;
    }
  } catch (error) {
    logger.warn("Sequential supporting call threw error, using master resume supporting sections", {
      jobId: context?.jobId,
      error,
    });
    hasErrors = true;
  }

  // Merge dynamic LLM output with static master resume data
  const tailoredResumeJson = mergeStaticAndDynamic(
    input.masterResumeJson,
    dynamicData,
  );

  // Extract metadata
  const metadata = tailoredResumeJson.metadata as
    | { pageCount: number; selectedSkills: string[] }
    | undefined;

  // Extract proof points from skills
  const skills = tailoredResumeJson.skills as Array<{
    name: string;
    proofPoint?: string;
  }>;
  const proofPoints: Record<string, string> = {};
  skills.forEach((skill) => {
    if (skill.proofPoint) {
      proofPoints[skill.name] = skill.proofPoint;
    }
  });

  if (hasErrors) {
    logger.info("Sequential tailoring completed with some errors, fell back to master resume data for failed sections", {
      jobId: context?.jobId,
    });
  }

  return {
    success: true,
    data: {
      tailoredResumeJson,
      metadata: {
        pageCount: metadata?.pageCount ?? 2,
        selectedSkills: metadata?.selectedSkills ?? [],
        proofPoints,
      },
    },
  };
}

/**
 * Merge static master resume data with dynamic LLM-generated data.
 * Static fields (basics, work company/position/dates, education institution/dates) are preserved.
 * Dynamic fields (summary, work highlights, education courses, projects, skills, certifications) come from LLM.
 */
function mergeStaticAndDynamic(
  masterResume: Record<string, unknown>,
  dynamicData: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...masterResume };

  // Preserve static basics
  result.basics = masterResume.basics;

  // Replace with dynamic summary
  if (dynamicData.summary) {
    result.summary = dynamicData.summary;
  }

  // Merge work: preserve static fields, replace dynamic fields
  // Work entries must stay in chronological order (master resume order)
  if (masterResume.work && Array.isArray(masterResume.work) && dynamicData.work && Array.isArray(dynamicData.work)) {
    const staticWork = masterResume.work as Array<Record<string, unknown>>;
    const dynamicWork = dynamicData.work as Array<Record<string, unknown>>;
    
    // LLM should return same number of entries as master resume (chronological order)
    // If counts differ, use min to avoid index errors
    const mergeCount = Math.min(staticWork.length, dynamicWork.length);
    
    result.work = staticWork.map((staticEntry, index) => {
      if (index < mergeCount) {
        return {
          ...staticEntry, // Preserve company, position, startDate, endDate, url
          summary: dynamicWork[index]?.summary,
          highlights: dynamicWork[index]?.highlights,
        };
      }
      // If LLM returned fewer entries, keep original static entry
      return staticEntry;
    });
  }

  // Merge education: preserve static fields, replace dynamic courses
  if (masterResume.education && Array.isArray(masterResume.education) && dynamicData.education && Array.isArray(dynamicData.education)) {
    const staticEdu = masterResume.education as Array<Record<string, unknown>>;
    const dynamicEdu = dynamicData.education as Array<Record<string, unknown>>;
    
    const mergeCount = Math.min(staticEdu.length, dynamicEdu.length);
    
    result.education = staticEdu.map((staticEntry, index) => {
      if (index < mergeCount) {
        return {
          ...staticEntry, // Preserve institution, area, studyType, startDate, endDate, url
          courses: dynamicEdu[index]?.courses,
        };
      }
      return staticEntry;
    });
  }

  // Merge projects: preserve static fields, replace dynamic fields
  if (masterResume.projects && Array.isArray(masterResume.projects) && dynamicData.projects && Array.isArray(dynamicData.projects)) {
    // For projects, LLM selects which ones to include, so we need to match by name
    const dynamicProjectsMap = new Map(
      (dynamicData.projects as Array<Record<string, unknown>>).map((p) => [String(p.name), p])
    );
    result.projects = (masterResume.projects as Array<Record<string, unknown>>)
      .filter((p) => dynamicProjectsMap.has(String(p.name)))
      .map((staticProject) => {
        const dynamicProject = dynamicProjectsMap.get(String(staticProject.name));
        return {
          ...staticProject, // Preserve name, startDate, endDate, url
          description: dynamicProject?.description,
          keywords: dynamicProject?.keywords,
        };
      });
  }

  // Replace skills entirely (LLM selects and tailors)
  if (dynamicData.skills) {
    result.skills = dynamicData.skills;
  }

  // Merge certifications: preserve static fields, LLM selects which ones
  if (masterResume.certifications && Array.isArray(masterResume.certifications) && dynamicData.certifications && Array.isArray(dynamicData.certifications)) {
    const dynamicCertsMap = new Map(
      (dynamicData.certifications as Array<Record<string, unknown>>).map((c) => [String(c.name), c])
    );
    result.certifications = (masterResume.certifications as Array<Record<string, unknown>>)
      .filter((c) => dynamicCertsMap.has(String(c.name)))
      .map((staticCert) => {
        const dynamicCert = dynamicCertsMap.get(String(staticCert.name));
        return {
          ...staticCert, // Preserve name, issuer, date
        };
      });
  }

  // Add metadata from LLM
  if (dynamicData.metadata) {
    result.metadata = dynamicData.metadata;
  }

  return result;
}

