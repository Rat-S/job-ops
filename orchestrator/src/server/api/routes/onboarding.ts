import { Router, Request, Response } from 'express';
import { readFile, stat } from 'fs/promises';

import { resumeDataSchema } from '@shared/rxresume-schema.js';
import { DEFAULT_PROFILE_PATH } from '@server/services/profile.js';
import { RxResumeClient } from '@server/services/rxresume-client.js';

export const onboardingRouter = Router();

type ValidationResponse = {
  valid: boolean;
  message: string | null;
};

async function validateOpenrouter(apiKey?: string | null): Promise<ValidationResponse> {
  const key = apiKey?.trim() || process.env.OPENROUTER_API_KEY || '';
  if (!key) {
    return { valid: false, message: 'OpenRouter API key is missing.' };
  }

  try {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${key}`,
      },
    });

    if (!response.ok) {
      let detail = '';
      try {
        const payload = await response.json();
        if (payload && typeof payload === 'object' && 'error' in payload) {
          const errorObj = payload.error as { message?: string; code?: number | string };
          const message = errorObj?.message || '';
          const code = errorObj?.code ? ` (${errorObj.code})` : '';
          detail = `${message}${code}`.trim();
        }
      } catch {
        // ignore JSON parse errors
      }

      if (response.status === 401) {
        return { valid: false, message: 'Invalid OpenRouter API key. Check the key and try again.' };
      }

      const fallback = `OpenRouter returned ${response.status}`;
      return { valid: false, message: detail || fallback };
    }

    return { valid: true, message: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'OpenRouter validation failed.';
    return { valid: false, message };
  }
}

async function validateResumeJson(): Promise<ValidationResponse> {
  try {
    const fileInfo = await stat(DEFAULT_PROFILE_PATH);
    if (!fileInfo.isFile() || fileInfo.size === 0) {
      return { valid: false, message: 'Resume JSON is missing.' };
    }

    const raw = await readFile(DEFAULT_PROFILE_PATH, 'utf-8');
    const parsed = JSON.parse(raw);
    const result = resumeDataSchema.safeParse(parsed);
    if (!result.success) {
      const issue = result.error.issues[0];
      const path = issue?.path?.join('.') || '';
      const baseMessage = issue?.message ?? 'Resume JSON does not match the expected schema.';
      const details = path
        ? `Field "${path}": ${baseMessage}`
        : baseMessage;
      return { valid: false, message: details };
    }

    return { valid: true, message: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to read resume JSON.';
    return { valid: false, message };
  }
}

async function validateRxresume(email?: string | null, password?: string | null): Promise<ValidationResponse> {
  const rxEmail = email?.trim() || process.env.RXRESUME_EMAIL || '';
  const rxPassword = password?.trim() || process.env.RXRESUME_PASSWORD || '';

  if (!rxEmail || !rxPassword) {
    return { valid: false, message: 'RxResume credentials are missing.' };
  }

  const result = await RxResumeClient.verifyCredentials(rxEmail, rxPassword);

  if (result.ok) {
    return { valid: true, message: null };
  }

  const normalizedMessage = result.message?.toLowerCase() ?? '';
  if (result.status === 401 || normalizedMessage.includes('invalidcredentials')) {
    return { valid: false, message: 'Invalid RxResume credentials. Check your email and password and try again.' };
  }

  const message = result.message || `RxResume validation failed (HTTP ${result.status})`;
  return { valid: false, message };
}

onboardingRouter.post('/validate/openrouter', async (req: Request, res: Response) => {
  const apiKey = typeof req.body?.apiKey === 'string' ? req.body.apiKey : undefined;
  const result = await validateOpenrouter(apiKey);
  res.json({ success: true, data: result });
});

onboardingRouter.post('/validate/rxresume', async (req: Request, res: Response) => {
  const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
  const password = typeof req.body?.password === 'string' ? req.body.password : undefined;
  const result = await validateRxresume(email, password);
  res.json({ success: true, data: result });
});

onboardingRouter.get('/validate/resume', async (_req: Request, res: Response) => {
  const result = await validateResumeJson();
  res.json({ success: true, data: result });
});
