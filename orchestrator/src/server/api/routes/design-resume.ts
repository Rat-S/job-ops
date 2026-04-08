import { badRequest, notFound, toAppError } from "@infra/errors";
import { asyncRoute, fail, ok } from "@infra/http";
import {
  deleteDesignResumePicture,
  exportDesignResume,
  getCurrentDesignResume,
  getDesignResumeStatus,
  importDesignResumeFromReactiveResume,
  readDesignResumeAssetContent,
  updateCurrentDesignResume,
  uploadDesignResumePicture,
} from "@server/services/design-resume";
import { generateDesignResumePdf } from "@server/services/pdf";
import { clearProfileCache } from "@server/services/profile";
import { type Request, type Response, Router } from "express";
import { z } from "zod";

export const designResumeRouter = Router();

const patchSchema = z.object({
  baseRevision: z.number().int().min(1),
  document: z.record(z.string(), z.unknown()).optional(),
  operations: z
    .array(
      z.object({
        op: z.enum(["add", "remove", "replace", "move", "copy", "test"]),
        path: z.string(),
        from: z.string().optional(),
        value: z.unknown().optional(),
      }),
    )
    .optional(),
});

const uploadSchema = z.object({
  fileName: z.string().trim().min(1).max(255),
  dataUrl: z.string().trim().min(1),
});

designResumeRouter.get(
  "/",
  asyncRoute(async (_req: Request, res: Response) => {
    const document = await getCurrentDesignResume();
    if (!document) {
      fail(res, notFound("Design Resume has not been imported yet."));
      return;
    }
    ok(res, document);
  }),
);

designResumeRouter.get(
  "/status",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, await getDesignResumeStatus());
  }),
);

designResumeRouter.post(
  "/import/rxresume",
  asyncRoute(async (_req: Request, res: Response) => {
    const document = await importDesignResumeFromReactiveResume();
    clearProfileCache();
    ok(res, document, 201);
  }),
);

designResumeRouter.patch(
  "/",
  asyncRoute(async (req: Request, res: Response) => {
    const input = patchSchema.parse(req.body);
    const document = await updateCurrentDesignResume(input);
    clearProfileCache();
    ok(res, document);
  }),
);

designResumeRouter.post(
  "/assets",
  asyncRoute(async (req: Request, res: Response) => {
    const input = uploadSchema.parse(req.body);
    const document = await uploadDesignResumePicture({
      fileName: input.fileName,
      dataUrl: input.dataUrl,
    });
    clearProfileCache();
    ok(res, document, 201);
  }),
);

designResumeRouter.delete(
  "/assets/picture",
  asyncRoute(async (_req: Request, res: Response) => {
    const document = await deleteDesignResumePicture();
    clearProfileCache();
    ok(res, document);
  }),
);

designResumeRouter.get(
  "/assets/:assetId/content",
  asyncRoute(async (req: Request, res: Response) => {
    const assetId = req.params.assetId?.trim();
    if (!assetId) {
      fail(res, badRequest("Asset id is required."));
      return;
    }

    const { asset, content } = await readDesignResumeAssetContent(assetId);
    res.setHeader("Content-Type", asset.mimeType);
    res.setHeader("Cache-Control", "private, max-age=60");
    res.send(content);
  }),
);

designResumeRouter.get(
  "/export",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, await exportDesignResume());
  }),
);

designResumeRouter.post(
  "/generate-pdf",
  asyncRoute(async (_req: Request, res: Response) => {
    ok(res, await generateDesignResumePdf());
  }),
);

designResumeRouter.use(
  (error: unknown, _req: Request, res: Response, _next: () => void) => {
    fail(res, toAppError(error));
  },
);
