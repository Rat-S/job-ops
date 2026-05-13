export type ResumeGenerationBackend = "native" | "resume_ops";

export function getResumeGenerationBackend(): ResumeGenerationBackend {
  const value = (process.env.RESUME_GENERATION_BACKEND || "native").toLowerCase();
  if (value !== "native" && value !== "resume_ops") {
    return "native";
  }
  return value as ResumeGenerationBackend;
}

export function getResumeOpsConfig(): { baseUrl: string; timeoutMs: number; theme?: string } | null {
  const backend = getResumeGenerationBackend();
  if (backend !== "resume_ops") return null;
  
  const baseUrl = process.env.RESUME_OPS_BASE_URL;
  if (!baseUrl) {
    throw new Error("RESUME_OPS_BASE_URL is required when RESUME_GENERATION_BACKEND=resume_ops");
  }
  
  return {
    baseUrl: baseUrl.replace(/\/+$/, ""),
    timeoutMs: parseInt(process.env.RESUME_OPS_REQUEST_TIMEOUT_MS || "120000", 10),
    theme: process.env.RESUME_OPS_THEME || undefined,
  };
}
