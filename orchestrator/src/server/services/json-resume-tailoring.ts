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

/** JSON schema for granular tailoring - only dynamic fields (static fields preserved from master resume) */
const JSON_RESUME_TAILORING_GRANULAR_SCHEMA: JsonSchemaDefinition = {
  name: "json_resume_tailoring_granular",
  schema: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph",
      },
      work: {
        type: "array",
        description: "Work experience with tailored bullet points (company, position, dates are static from master resume)",
        items: {
          type: "object",
          properties: {
            summary: { type: "string", description: "Job summary paragraph" },
            highlights: {
              type: "array",
              items: { type: "string", description: "Tailored bullet points for this role" },
            },
          },
        },
      },
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
    required: ["summary", "work", "skills"],
    additionalProperties: false,
  },
};

/** JSON schema for supporting JSON Resume sections (education, projects, skills, certifications, metadata) */
const JSON_RESUME_TAILORING_SUPPORTING_SCHEMA: JsonSchemaDefinition = {
  name: "json_resume_tailoring_supporting",
  schema: {
    type: "object",
    properties: {
      education: {
        type: "array",
        description: "Education entries",
        items: {
          type: "object",
          properties: {
            institution: { type: "string" },
            area: { type: "string" },
            studyType: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
          },
          required: ["institution", "area"],
        },
      },
      projects: {
        type: "array",
        description: "Project entries, selected and tailored for relevance",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            description: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            url: { type: "string" },
            keywords: {
              type: "array",
              items: { type: "string" },
            },
          },
          required: ["name", "description"],
        },
      },
      skills: {
        type: "array",
        description: "Skills with proof-point evidence for top 5 skills",
        items: {
          type: "object",
          properties: {
            name: { type: "string", description: "Skill category name" },
            keywords: {
              type: "array",
              items: { type: "string" },
              description: "List of skills in this category",
            },
            proofPoint: {
              type: "string",
              description:
                "1-sentence evidence demonstrating this skill from work history",
            },
          },
        },
      },
      certifications: {
        type: "array",
        description: "Certification entries",
        items: {
          type: "object",
          properties: {
            name: { type: "string" },
            issuer: { type: "string" },
            date: { type: "string" },
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
    required: ["education", "skills"],
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

  // Handle certifications
  if (data.certifications && Array.isArray(data.certifications)) {
    lines.push("## Certifications");
    (data.certifications as Array<Record<string, unknown>>).forEach((c) => {
      const parts = [];
      if (c.name) parts.push(c.name);
      if (c.issuer) parts.push(`- ${c.issuer}`);
      if (c.date) parts.push(`(${c.date})`);
      lines.push(parts.join(" "));
    });
  }

  return lines.join("\n");
}

/**
 * Generate complete tailored JSON Resume for a job using LLM.
 * Uses single granular call: only dynamic fields (summary, work highlights, education courses, projects, skills, certifications).
 * Static fields (basics, work company/position/dates, education institution/dates) are preserved from master resume.
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

  // Single call: Generate all dynamic sections using granular schema
  const prompt = await buildJsonResumeTailoringPrompt(
    input.masterResumeJson,
    input.jobDescription,
    writingStyle,
    input.constraints,
    "granular",
  );

  if (!JSON_RESUME_TAILORING_GRANULAR_SCHEMA || !JSON_RESUME_TAILORING_GRANULAR_SCHEMA.schema) {
    return { success: false, error: "Granular JSON schema or its schema property is undefined" };
  }

  const result = await llm.callJson<Record<string, unknown>>({
    model,
    messages: [{ role: "user", content: prompt }],
    jsonSchema: JSON_RESUME_TAILORING_GRANULAR_SCHEMA,
  });

  // Log call
  await logLlmCall(
    createLlmLogEntry({
      model,
      context: {
        jobId: context?.jobId,
        pipelineRunId: context?.pipelineRunId,
        operation: "jsonResumeTailoring_granular",
      },
      request: {
        prompt,
        schema: JSON_RESUME_TAILORING_GRANULAR_SCHEMA,
        jobDescriptionLength: input.jobDescription.length,
        masterResumeSize: JSON.stringify(input.masterResumeJson).length,
      },
      response: {
        success: result.success,
        data: result.success ? result.data : undefined,
        error: result.success ? undefined : result.error,
      },
      metadata: {
        duration: Date.now() - startTime,
      },
    }),
  );

  if (!result.success) {
    const contextStr = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (result.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${contextStr})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `Granular tailoring failed: ${result.error} (${contextStr})`,
    };
  }

  // Merge dynamic LLM output with static master resume data
  const tailoredResumeJson = mergeStaticAndDynamic(
    input.masterResumeJson,
    result.data as Record<string, unknown>,
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

async function buildJsonResumeTailoringPrompt(
  masterResumeJson: Record<string, unknown>,
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
  constraints?: JsonResumeTailoringInput["constraints"],
  sectionType?: "core" | "supporting" | "granular",
): Promise<string> {
  logger.info("Building JSON resume tailoring prompt", { sectionType });
  try {
    const resolvedLanguage = resolveWritingOutputLanguage({
      style: writingStyle,
      profile: masterResumeJson as any,
    });
    const outputLanguage = getWritingLanguageLabel(resolvedLanguage.language);
    let effectiveConstraints = stripLanguageDirectivesFromConstraints(
      writingStyle.constraints,
    );
    if (writingStyle.summaryMaxWords != null) {
      effectiveConstraints = stripWordLimitFromConstraints(effectiveConstraints);
    }

  // Extract relevant sections from master resume to save tokens
  const relevantProfile = sectionType === "granular"
    ? {
        basics: (masterResumeJson.basics as any) || {},
        summary: (masterResumeJson.summary as any) || "",
        work: (masterResumeJson.work as any) || [],
        education: (masterResumeJson.education as any) || [],
        projects: (masterResumeJson.projects as any) || [],
        skills: (masterResumeJson.skills as any) || [],
        certifications: (masterResumeJson.certifications as any) || [],
      }
    : sectionType === "supporting"
      ? {
          education: (masterResumeJson.education as any) || [],
          projects: (masterResumeJson.projects as any) || [],
          skills: (masterResumeJson.skills as any) || [],
          certifications: (masterResumeJson.certifications as any) || [],
        }
      : {
          basics: (masterResumeJson.basics as any) || {},
          summary: (masterResumeJson.summary as any) || "",
          work: (masterResumeJson.work as any) || [],
        };

  const maxPages = constraints?.maxPages ?? 2;
  const targetKeywords = constraints?.targetKeywords?.join(", ") || "";

  const templateKey = sectionType === "granular"
    ? "jsonResumeTailoringGranularPromptTemplate"
    : sectionType === "supporting"
      ? "jsonResumeTailoringSupportingPromptTemplate"
      : "jsonResumeTailoringPromptTemplate";

  const template = await getEffectivePromptTemplate(templateKey);

  // Use compact format for token efficiency
  const compactResume = convertToCompactFormat(relevantProfile);

  return renderPromptTemplate(template, {
    jobDescription: jd,
    masterResumeJson: compactResume,
    outputLanguage,
    tone: writingStyle.tone,
    formality: writingStyle.formality,
    maxPages,
    targetKeywords,
    constraintsBullet: effectiveConstraints
      ? `- Additional constraints: ${effectiveConstraints}`
      : "",
    avoidTermsBullet: writingStyle.doNotUse
      ? `- Avoid these words or phrases: ${writingStyle.doNotUse}`
      : "",
  });
  } catch (error) {
    logger.error("Failed to build JSON resume tailoring prompt", {
      sectionType,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
