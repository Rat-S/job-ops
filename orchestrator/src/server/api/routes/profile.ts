import { Router, Request, Response } from 'express';
import { mkdir, stat, writeFile } from 'fs/promises';
import { dirname } from 'path';
import { extractProjectsFromProfile } from '../../services/resumeProjects.js';
import { clearProfileCache, DEFAULT_PROFILE_PATH, getProfile } from '../../services/profile.js';
import { resumeDataSchema } from '@shared/rxresume-schema.js';

export const profileRouter = Router();

async function profileExists(): Promise<boolean> {
  try {
    const fileInfo = await stat(DEFAULT_PROFILE_PATH);
    return fileInfo.isFile() && fileInfo.size > 0;
  } catch {
    return false;
  }
}

/**
 * GET /api/profile/projects - Get all projects available in the base resume
 */
profileRouter.get('/projects', async (req: Request, res: Response) => {
  try {
    if (!(await profileExists())) {
      res.json({ success: true, data: [] });
      return;
    }
    const profile = await getProfile();
    const { catalog } = extractProjectsFromProfile(profile);
    res.json({ success: true, data: catalog });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/profile - Get the full base resume profile
 */
profileRouter.get('/', async (req: Request, res: Response) => {
  try {
    if (!(await profileExists())) {
      res.json({ success: true, data: null });
      return;
    }
    const profile = await getProfile();
    res.json({ success: true, data: profile });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.status(500).json({ success: false, error: message });
  }
});

/**
 * GET /api/profile/status - Check if base resume exists
 */
profileRouter.get('/status', async (_req: Request, res: Response) => {
  try {
    const fileInfo = await stat(DEFAULT_PROFILE_PATH);
    const exists = fileInfo.isFile() && fileInfo.size > 0;
    res.json({ success: true, data: { exists, error: exists ? null : 'Resume file is empty' } });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    res.json({ success: true, data: { exists: false, error: message } });
  }
});

/**
 * POST /api/profile/upload - Upload base resume JSON
 */
profileRouter.post('/upload', async (req: Request, res: Response) => {
  try {
    const profile = (req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).profile : null) as unknown;

    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
      throw new Error('Invalid profile payload. Expected a JSON object.');
    }

    const parsed = resumeDataSchema.safeParse(profile);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const path = issue?.path?.join('.') || '';
      const baseMessage = issue?.message ?? 'Resume JSON does not match the RxResume schema.';
      const details = path ? `Field "${path}": ${baseMessage}` : baseMessage;
      throw new Error(`Invalid resume JSON: ${details}`);
    }

    const existing = await stat(DEFAULT_PROFILE_PATH).catch(() => null);
    if (existing && existing.isDirectory()) {
      throw new Error('Resume path is a directory. Remove it and upload again.');
    }

    await mkdir(dirname(DEFAULT_PROFILE_PATH), { recursive: true });
    await writeFile(DEFAULT_PROFILE_PATH, JSON.stringify(parsed.data, null, 2), 'utf-8');
    clearProfileCache();

    res.json({ success: true, data: { exists: true, error: null } });
  } catch (error) {
    let message = error instanceof Error ? error.message : 'Unknown error';
    if (error && typeof error === 'object' && 'code' in error) {
      const code = (error as { code?: string }).code;
      if (code === 'EROFS') {
        message = 'Resume path is read-only. Remove the bind mount and restart the container.';
      }
    }
    res.status(400).json({ success: false, error: message });
  }
});
