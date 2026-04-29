/**
 * LLM Logging Service
 *
 * Logs all LLM calls (request and response) to a file for debugging and analysis.
 * Uses JSON Lines format for easy parsing.
 */

import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getDataDir } from "../config/dataDir";

export interface LlmLogEntry {
  timestamp: string;
  model: string;
  context?: {
    jobId?: string;
    pipelineRunId?: string;
    operation?: string;
  };
  request: {
    prompt?: string;
    systemPrompt?: string;
    messages?: Array<{ role: string; content: string }>;
    schema?: unknown;
    [key: string]: unknown;
  };
  response: {
    success: boolean;
    data?: unknown;
    error?: string;
    [key: string]: unknown;
  };
  metadata?: {
    duration?: number;
    tokens?: {
      input?: number;
      output?: number;
      total?: number;
    };
    [key: string]: unknown;
  };
}

const LOG_FILE = "llm-logs.jsonl";
const MD_LOG_FILE = "llm-logs.md";

/**
 * Log an LLM call to the log file (both JSON Lines and Markdown)
 */
export async function logLlmCall(entry: LlmLogEntry): Promise<void> {
  try {
    const dataDir = getDataDir();
    const logPath = join(dataDir, LOG_FILE);
    const mdLogPath = join(dataDir, MD_LOG_FILE);

    // Ensure data directory exists
    await mkdir(dataDir, { recursive: true });

    // Write JSON Lines entry
    const logLine = JSON.stringify(entry) + "\n";
    await appendFile(logPath, logLine, "utf8");

    // Write Markdown entry
    const mdEntry = formatMarkdownEntry(entry);
    await appendFile(mdLogPath, mdEntry, "utf8");
  } catch (error) {
    // Don't fail the operation if logging fails
    logger.warn("Failed to write LLM log entry", error);
  }
}

/**
 * Format log entry as Markdown for human readability
 */
function formatMarkdownEntry(entry: LlmLogEntry): string {
  const lines: string[] = [];

  lines.push(`---`);
  lines.push(`## [${entry.timestamp}] - ${entry.context?.operation || 'LLM Call'}`);
  lines.push(``);
  lines.push(`**Model:** ${entry.model}`);
  if (entry.context?.jobId) lines.push(`**Job ID:** ${entry.context.jobId}`);
  if (entry.context?.pipelineRunId) lines.push(`**Pipeline Run ID:** ${entry.context.pipelineRunId}`);
  lines.push(``);

  // Request section
  lines.push(`### Request`);
  if (entry.request.prompt) {
    lines.push(``);
    lines.push(`\`\`\``);
    lines.push(entry.request.prompt);
    lines.push(`\`\`\``);
  }
  if (entry.request.messages && entry.request.messages.length > 0) {
    lines.push(``);
    lines.push(`**Messages:**`);
    entry.request.messages.forEach((msg, i) => {
      lines.push(``);
      lines.push(`**[${i}] ${msg.role}:**`);
      lines.push(`\`\`\``);
      lines.push(msg.content);
      lines.push(`\`\`\``);
    });
  }
  if (entry.request.schema) {
    lines.push(``);
    lines.push(`**Schema:**`);
    lines.push(`\`\`\`json`);
    lines.push(JSON.stringify(entry.request.schema, null, 2));
    lines.push(`\`\`\``);
  }
  lines.push(``);

  // Response section
  lines.push(`### Response`);
  lines.push(`**Success:** ${entry.response.success}`);
  if (entry.metadata?.duration) lines.push(`**Duration:** ${entry.metadata.duration}ms`);
  if (entry.metadata?.tokens) {
    const t = entry.metadata.tokens;
    lines.push(`**Tokens:** Input=${t.input ?? 'N/A'}, Output=${t.output ?? 'N/A'}, Total=${t.total ?? 'N/A'}`);
  }
  lines.push(``);

  if (entry.response.error) {
    lines.push(`**Error:**`);
    lines.push(`\`\`\``);
    lines.push(entry.response.error);
    lines.push(`\`\`\``);
  }

  if (entry.response.data) {
    lines.push(`**Data:**`);
    lines.push(`\`\`\`json`);
    lines.push(JSON.stringify(entry.response.data, null, 2));
    lines.push(`\`\`\``);
  }
  lines.push(``);
  lines.push(``);

  return lines.join("\n");
}

/**
 * Create a log entry helper
 */
export function createLlmLogEntry(params: {
  model: string;
  context?: LlmLogEntry["context"];
  request: LlmLogEntry["request"];
  response: LlmLogEntry["response"];
  metadata?: LlmLogEntry["metadata"];
}): LlmLogEntry {
  return {
    timestamp: new Date().toISOString(),
    model: params.model,
    context: params.context,
    request: params.request,
    response: params.response,
    metadata: params.metadata,
  };
}
