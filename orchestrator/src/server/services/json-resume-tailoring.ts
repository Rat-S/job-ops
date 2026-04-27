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

/** JSON schema for core JSON Resume sections (basics, summary, work) */
const JSON_RESUME_TAILORING_CORE_SCHEMA: JsonSchemaDefinition = {
  name: "json_resume_tailoring_core",
  schema: {
    type: "object",
    properties: {
      basics: {
        type: "object",
        properties: {
          name: { type: "string" },
          label: { type: "string", description: "Job title/headline" },
          email: { type: "string" },
          phone: { type: "string" },
          url: { type: "string" },
          location: { type: "object" },
          profiles: {
            type: "array",
            items: { type: "object" },
          },
        },
      },
      summary: {
        type: "string",
        description: "Tailored resume summary paragraph",
      },
      work: {
        type: "array",
        description:
          "Work experience entries, tailored and reordered for relevance",
        items: {
          type: "object",
          properties: {
            company: { type: "string" },
            position: { type: "string" },
            startDate: { type: "string" },
            endDate: { type: "string" },
            summary: { type: "string" },
            highlights: {
              type: "array",
              items: { type: "string" },
            },
          },
        },
      },
    },
    required: ["basics", "summary", "work"],
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
 * Generate complete tailored JSON Resume for a job using LLM.
 * Makes two sequential calls: one for core sections (basics, summary, work),
 * one for supporting sections (education, projects, skills, certifications, metadata).
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

  // Call 1: Generate core sections (basics, summary, work)
  const corePrompt = await buildJsonResumeTailoringPrompt(
    input.masterResumeJson,
    input.jobDescription,
    writingStyle,
    input.constraints,
    "core",
  );

  if (!JSON_RESUME_TAILORING_CORE_SCHEMA || !JSON_RESUME_TAILORING_CORE_SCHEMA.schema) {
    return { success: false, error: "Core JSON schema or its schema property is undefined" };
  }

  const coreResult = await llm.callJson<Record<string, unknown>>({
    model,
    messages: [{ role: "user", content: corePrompt }],
    jsonSchema: JSON_RESUME_TAILORING_CORE_SCHEMA,
  });

  // Log core call
  await logLlmCall(
    createLlmLogEntry({
      model,
      context: {
        jobId: context?.jobId,
        pipelineRunId: context?.pipelineRunId,
        operation: "jsonResumeTailoring_core",
      },
      request: {
        prompt: corePrompt,
        schema: JSON_RESUME_TAILORING_CORE_SCHEMA,
        jobDescriptionLength: input.jobDescription.length,
        masterResumeSize: JSON.stringify(input.masterResumeJson).length,
      },
      response: {
        success: coreResult.success,
        data: coreResult.success ? coreResult.data : undefined,
        error: coreResult.success ? undefined : coreResult.error,
      },
      metadata: {
        duration: Date.now() - startTime,
      },
    }),
  );

  if (!coreResult.success) {
    const contextStr = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    if (coreResult.error.toLowerCase().includes("api key")) {
      const message = `LLM API key not set, cannot generate tailoring. (${contextStr})`;
      logger.warn(message);
      return { success: false, error: message };
    }
    return {
      success: false,
      error: `Core tailoring failed: ${coreResult.error} (${contextStr})`,
    };
  }

  // Call 2: Generate supporting sections (education, projects, skills, certifications, metadata)
  logger.info("Building supporting prompt", { jobId: context?.jobId });
  const supportingPrompt = await buildJsonResumeTailoringPrompt(
    input.masterResumeJson,
    input.jobDescription,
    writingStyle,
    input.constraints,
    "supporting",
  );

  if (!JSON_RESUME_TAILORING_SUPPORTING_SCHEMA || !JSON_RESUME_TAILORING_SUPPORTING_SCHEMA.schema) {
    return { success: false, error: "Supporting JSON schema or its schema property is undefined" };
  }

  logger.info("Calling LLM for supporting sections", { jobId: context?.jobId });
  let supportingResult;
  try {
    supportingResult = await llm.callJson<Record<string, unknown>>({
      model,
      messages: [{ role: "user", content: supportingPrompt }],
      jsonSchema: JSON_RESUME_TAILORING_SUPPORTING_SCHEMA,
    });
  } catch (error) {
    logger.error("LLM call for supporting sections failed", {
      jobId: context?.jobId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return {
      success: false,
      error: `Supporting LLM call failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  // Log supporting call
  await logLlmCall(
    createLlmLogEntry({
      model,
      context: {
        jobId: context?.jobId,
        pipelineRunId: context?.pipelineRunId,
        operation: "jsonResumeTailoring_supporting",
      },
      request: {
        prompt: supportingPrompt,
        schema: JSON_RESUME_TAILORING_SUPPORTING_SCHEMA,
        jobDescriptionLength: input.jobDescription.length,
        masterResumeSize: JSON.stringify(input.masterResumeJson).length,
      },
      response: {
        success: supportingResult.success,
        data: supportingResult.success ? supportingResult.data : undefined,
        error: supportingResult.success ? undefined : supportingResult.error,
      },
      metadata: {
        duration: Date.now() - startTime,
      },
    }),
  );

  if (!supportingResult.success) {
    const contextStr = `provider=${llm.getProvider()} baseUrl=${llm.getBaseUrl()}`;
    return {
      success: false,
      error: `Supporting tailoring failed: ${supportingResult.error} (${contextStr})`,
    };
  }

  // Merge results
  const tailoredResumeJson = {
    ...coreResult.data,
    ...supportingResult.data,
  };

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

async function buildJsonResumeTailoringPrompt(
  masterResumeJson: Record<string, unknown>,
  jd: string,
  writingStyle: Awaited<ReturnType<typeof getWritingStyle>>,
  constraints?: JsonResumeTailoringInput["constraints"],
  sectionType?: "core" | "supporting",
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
  const relevantProfile = sectionType === "supporting"
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

  const templateKey = sectionType === "supporting"
    ? "jsonResumeTailoringSupportingPromptTemplate"
    : "jsonResumeTailoringPromptTemplate";

  const template = await getEffectivePromptTemplate(templateKey);

  return renderPromptTemplate(template, {
    jobDescription: jd,
    masterResumeJson: JSON.stringify(relevantProfile, null, 2),
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
