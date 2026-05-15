import { getResumeOpsConfig } from "../config/resume-ops.js";

interface TailorRequest {
  job_description: string;
  theme?: string;
}

interface TailorResponse {
  resume: Record<string, unknown>;
  pdf_base64: string;
  theme: string;
}

interface MasterResumeStatus {
  configured: boolean;
  exists: boolean;
  valid: boolean;
  message: string;
}

export async function tailorResume(request: TailorRequest): Promise<TailorResponse> {
  const config = getResumeOpsConfig();
  if (!config) {
    throw new Error("ResumeOps is not configured");
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/api/v1/tailor`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        ...request,
        theme: request.theme || config.theme,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      let errorMessage = `ResumeOps API error: ${response.status} ${response.statusText}`;
      try {
        const errorData = await response.json();
        if (errorData.detail || errorData.details || errorData.message) {
          errorMessage += ` - ${JSON.stringify(errorData)}`;
        }
      } catch (e) {
        // ignore JSON parse error
      }
      throw new Error(errorMessage);
    }

    return await response.json() as TailorResponse;
  } finally {
    clearTimeout(timeoutId);
  }
}

export async function getMasterResumeStatus(): Promise<MasterResumeStatus> {
  const config = getResumeOpsConfig();
  if (!config) {
    return { configured: false, exists: false, valid: false, message: "ResumeOps not configured" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.timeoutMs);

  try {
    const response = await fetch(`${config.baseUrl}/api/v1/master-resume/status`, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`ResumeOps API error: ${response.status} ${response.statusText}`);
    }

    return await response.json() as MasterResumeStatus;
  } finally {
    clearTimeout(timeoutId);
  }
}
