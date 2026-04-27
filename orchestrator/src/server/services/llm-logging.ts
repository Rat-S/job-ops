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

/**
 * Log an LLM call to the log file
 */
export async function logLlmCall(entry: LlmLogEntry): Promise<void> {
  try {
    const dataDir = getDataDir();
    const logPath = join(dataDir, LOG_FILE);

    // Ensure data directory exists
    await mkdir(dataDir, { recursive: true });

    // Write log entry as JSON line
    const logLine = JSON.stringify(entry) + "\n";
    await appendFile(logPath, logLine, "utf8");
  } catch (error) {
    // Don't fail the operation if logging fails
    logger.warn("Failed to write LLM log entry", error);
  }
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
