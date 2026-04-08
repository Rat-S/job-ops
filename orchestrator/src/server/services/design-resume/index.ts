import { existsSync } from "node:fs";
import { mkdir, readFile, stat, unlink, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { badRequest, conflict, notFound } from "@infra/errors";
import { logger } from "@infra/logger";
import { sanitizeUnknown } from "@infra/sanitize";
import { createId } from "@paralleldrive/cuid2";
import { getDataDir } from "@server/config/dataDir";
import * as designResumeRepo from "@server/repositories/design-resume";
import { getResume } from "@server/services/rxresume";
import { getConfiguredRxResumeBaseResumeId } from "@server/services/rxresume/baseResumeId";
import { parseV4ResumeData } from "@server/services/rxresume/schema/v4";
import { parseV5ResumeData } from "@server/services/rxresume/schema/v5";
import type {
  DesignResumeAsset,
  DesignResumeDocument,
  DesignResumeExportResponse,
  DesignResumeJson,
  DesignResumePatchRequest,
  DesignResumeStatusResponse,
  ResumeProfile,
} from "@shared/types";

const DESIGN_RESUME_DIR = join(getDataDir(), "design-resume");
const DESIGN_RESUME_ASSET_DIR = join(DESIGN_RESUME_DIR, "assets");
const DESIGN_RESUME_DEFAULT_ID = "primary";
const IMAGE_MIME_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

type JsonPatchOperation = NonNullable<
  DesignResumePatchRequest["operations"]
>[number];

function defaultWebsite() {
  return { label: "", url: "" };
}

function defaultPicture() {
  return {
    url: "",
    show: true,
    size: 96,
    rotation: 0,
    aspectRatio: 1,
    borderRadius: 0,
    borderColor: "#d6d3d1",
    borderWidth: 0,
    shadowColor: "rgba(28,25,23,0.16)",
    shadowWidth: 0,
  };
}

function defaultSectionBase(title: string) {
  return {
    title,
    columns: 1,
    hidden: false,
  };
}

function buildDefaultDesignResume(): DesignResumeJson {
  return {
    picture: defaultPicture(),
    basics: {
      name: "",
      headline: "",
      email: "",
      phone: "",
      location: "",
      website: defaultWebsite(),
      customFields: [],
    },
    summary: {
      ...defaultSectionBase("Summary"),
      content: "",
    },
    sections: {
      profiles: { ...defaultSectionBase("Profiles"), items: [] },
      experience: { ...defaultSectionBase("Experience"), items: [] },
      education: { ...defaultSectionBase("Education"), items: [] },
      projects: { ...defaultSectionBase("Projects"), items: [] },
      skills: { ...defaultSectionBase("Skills"), items: [] },
      languages: { ...defaultSectionBase("Languages"), items: [] },
      interests: { ...defaultSectionBase("Interests"), items: [] },
      awards: { ...defaultSectionBase("Awards"), items: [] },
      certifications: { ...defaultSectionBase("Certifications"), items: [] },
      publications: { ...defaultSectionBase("Publications"), items: [] },
      volunteer: { ...defaultSectionBase("Volunteer"), items: [] },
      references: { ...defaultSectionBase("References"), items: [] },
    },
    customSections: [],
    metadata: {},
  };
}

function toBoolean(value: unknown, fallback = false): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function toNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function toText(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function makeWebsite(value: unknown) {
  const url = asRecord(value);
  return {
    label: toText(url?.label),
    url: toText(url?.url ?? url?.href),
  };
}

function mapV4ItemWebsite(value: unknown) {
  const url = asRecord(value);
  return {
    label: toText(url?.label),
    url: toText(url?.href),
  };
}

function mapV4SectionBase(
  section: Record<string, unknown> | null,
  title: string,
) {
  return {
    title: toText(section?.name, title),
    columns: toNumber(section?.columns, 1),
    hidden: !toBoolean(section?.visible, true),
  };
}

function normalizeV5Document(input: unknown): DesignResumeJson {
  const parsed = parseV5ResumeData(input) as Record<string, unknown>;
  const defaults = buildDefaultDesignResume();
  const basics = asRecord(parsed.basics) ?? {};
  const summary = asRecord(parsed.summary) ?? {};
  const sections = asRecord(parsed.sections) ?? {};
  const picture = asRecord(parsed.picture) ?? {};
  const { hidden: _hidden, ...pictureWithoutHidden } = picture;
  const show =
    typeof picture.show === "boolean"
      ? picture.show
      : !toBoolean(picture.hidden, false);

  return {
    ...defaults,
    ...parsed,
    picture: {
      ...defaultPicture(),
      ...pictureWithoutHidden,
      show,
    },
    basics: {
      ...(defaults.basics as Record<string, unknown>),
      ...basics,
      website: makeWebsite(basics.website),
      customFields: asArray(basics.customFields).map((field) => {
        const next = asRecord(field) ?? {};
        return {
          id: toText(next.id, createId()),
          icon: toText(next.icon),
          name: toText(next.name ?? next.text),
          value: toText(next.value ?? next.link ?? next.text),
          text: toText(next.text ?? next.name ?? next.value),
          link: toText(next.link ?? next.value),
        };
      }),
    },
    summary: {
      ...(defaults.summary as Record<string, unknown>),
      ...summary,
      title: toText(summary.title, "Summary"),
      columns: toNumber(summary.columns, 1),
      hidden: toBoolean(summary.hidden, false),
      content: toText(summary.content),
    },
    sections: Object.fromEntries(
      Object.entries({
        ...(defaults.sections as Record<string, unknown>),
        ...sections,
      }).map(([key, sectionValue]) => {
        const section = asRecord(sectionValue) ?? {};
        return [
          key,
          {
            ...defaultSectionBase(key.charAt(0).toUpperCase() + key.slice(1)),
            ...section,
            title: toText(
              section.title,
              key.charAt(0).toUpperCase() + key.slice(1),
            ),
            columns: toNumber(section.columns, 1),
            hidden: toBoolean(section.hidden, false),
            items: asArray(section.items),
          },
        ];
      }),
    ),
    customSections: asArray(parsed.customSections),
    metadata: asRecord(parsed.metadata) ?? {},
  };
}

function normalizeV4Document(input: unknown): DesignResumeJson {
  const parsed = parseV4ResumeData(input);
  const defaults = buildDefaultDesignResume();

  return {
    ...defaults,
    picture: {
      ...defaultPicture(),
      url: toText(parsed.basics.picture.url),
      show: !parsed.basics.picture.effects.hidden,
      size: parsed.basics.picture.size,
      aspectRatio: parsed.basics.picture.aspectRatio,
      borderRadius: parsed.basics.picture.borderRadius,
      borderWidth: parsed.basics.picture.effects.border ? 1 : 0,
    },
    basics: {
      name: parsed.basics.name,
      headline: parsed.basics.headline,
      email: parsed.basics.email,
      phone: parsed.basics.phone,
      location: parsed.basics.location,
      website: {
        label: parsed.basics.url.label,
        url: parsed.basics.url.href,
      },
      customFields: parsed.basics.customFields.map((field) => ({
        id: field.id,
        icon: field.icon,
        name: field.name,
        value: field.value,
        text: field.value,
        link: "",
      })),
    },
    summary: {
      ...mapV4SectionBase(parsed.sections.summary, "Summary"),
      content: parsed.sections.summary.content,
    },
    sections: {
      profiles: {
        ...mapV4SectionBase(parsed.sections.profiles, "Profiles"),
        items: parsed.sections.profiles.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          icon: item.icon,
          network: item.network,
          username: item.username,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
        })),
      },
      experience: {
        ...mapV4SectionBase(parsed.sections.experience, "Experience"),
        items: parsed.sections.experience.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          company: item.company,
          location: item.location,
          position: item.position,
          period: item.date,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
          roles: [],
        })),
      },
      education: {
        ...mapV4SectionBase(parsed.sections.education, "Education"),
        items: parsed.sections.education.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          school: item.institution,
          area: item.area,
          degree: item.studyType,
          grade: item.score,
          location: "",
          period: item.date,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
        })),
      },
      projects: {
        ...mapV4SectionBase(parsed.sections.projects, "Projects"),
        items: parsed.sections.projects.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          name: item.name,
          period: item.date,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
          technologies: item.keywords,
        })),
      },
      skills: {
        ...mapV4SectionBase(parsed.sections.skills, "Skills"),
        items: parsed.sections.skills.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          icon: "",
          name: item.name,
          proficiency: item.description,
          level: item.level,
          keywords: item.keywords,
        })),
      },
      languages: {
        ...mapV4SectionBase(parsed.sections.languages, "Languages"),
        items: parsed.sections.languages.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          language: item.name,
          fluency: item.description,
          level: item.level,
        })),
      },
      interests: {
        ...mapV4SectionBase(parsed.sections.interests, "Interests"),
        items: parsed.sections.interests.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          icon: "",
          name: item.name,
          keywords: item.keywords,
        })),
      },
      awards: {
        ...mapV4SectionBase(parsed.sections.awards, "Awards"),
        items: parsed.sections.awards.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          title: item.title,
          awarder: item.awarder,
          date: item.date,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
        })),
      },
      certifications: {
        ...mapV4SectionBase(parsed.sections.certifications, "Certifications"),
        items: parsed.sections.certifications.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          title: item.name,
          issuer: item.issuer,
          date: item.date,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
        })),
      },
      publications: {
        ...mapV4SectionBase(parsed.sections.publications, "Publications"),
        items: parsed.sections.publications.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          title: item.name,
          publisher: item.publisher,
          date: item.date,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
        })),
      },
      volunteer: {
        ...mapV4SectionBase(parsed.sections.volunteer, "Volunteer"),
        items: parsed.sections.volunteer.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          organization: item.organization,
          location: item.location,
          period: item.date,
          position: item.position,
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
        })),
      },
      references: {
        ...mapV4SectionBase(parsed.sections.references, "References"),
        items: parsed.sections.references.items.map((item) => ({
          id: item.id,
          hidden: !item.visible,
          name: item.name,
          position: item.description,
          phone: "",
          website: mapV4ItemWebsite(item.url),
          options: { showLinkInTitle: false },
          description: item.summary,
        })),
      },
    },
    customSections: [],
    metadata: parsed.metadata as Record<string, unknown>,
  };
}

function normalizeImportedResume(
  input: unknown,
  mode: "v4" | "v5",
): DesignResumeJson {
  return mode === "v4"
    ? normalizeV4Document(input)
    : normalizeV5Document(input);
}

function buildDocumentTitle(document: DesignResumeJson): string {
  const basics = asRecord(document.basics);
  const name = toText(basics?.name).trim();
  return name ? `${name} Resume` : "Design Resume";
}

function contentUrlForAsset(assetId: string): string {
  return `/api/design-resume/assets/${encodeURIComponent(assetId)}/content`;
}

function toDesignResumeAsset(
  row: Awaited<
    ReturnType<typeof designResumeRepo.getDesignResumeAssetById>
  > extends infer T
    ? NonNullable<T>
    : never,
): DesignResumeAsset {
  return {
    id: row.id,
    documentId: row.documentId,
    kind: row.kind,
    originalName: row.originalName,
    mimeType: row.mimeType,
    byteSize: row.byteSize,
    storagePath: row.storagePath,
    contentUrl: contentUrlForAsset(row.id),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

async function hydrateDocument(
  row: Awaited<
    ReturnType<typeof designResumeRepo.getLatestDesignResumeDocument>
  >,
): Promise<DesignResumeDocument | null> {
  if (!row) return null;
  const assets = await designResumeRepo.listDesignResumeAssets(row.id);
  return {
    id: row.id,
    title: row.title,
    resumeJson: (row.resumeJson ?? {}) as DesignResumeJson,
    revision: row.revision,
    sourceResumeId: row.sourceResumeId ?? null,
    sourceMode: row.sourceMode ?? null,
    importedAt: row.importedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    assets: assets.map(toDesignResumeAsset),
  };
}

function parseDataUrl(input: string): { mimeType: string; data: Buffer } {
  const match = /^data:([^;]+);base64,(.+)$/s.exec(input.trim());
  if (!match) {
    throw badRequest("Image payload must be a base64 data URL.");
  }

  const mimeType = match[1].toLowerCase();
  if (!IMAGE_MIME_TYPES.has(mimeType)) {
    throw badRequest("Only PNG, JPEG, and WebP images are supported.");
  }

  // Base64 expands by roughly 4/3, so we can reject oversized payloads
  // before decoding the entire string into memory.
  const estimatedByteLength = Math.floor((match[2].length * 3) / 4);
  if (estimatedByteLength > MAX_IMAGE_BYTES) {
    throw badRequest("Images must be 5 MB or smaller.");
  }

  const data = Buffer.from(match[2], "base64");
  if (data.byteLength > MAX_IMAGE_BYTES) {
    throw badRequest("Images must be 5 MB or smaller.");
  }

  return {
    mimeType,
    data,
  };
}

function extensionForMimeType(mimeType: string): string {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

function decodePointerToken(token: string): string {
  return token.replace(/~1/g, "/").replace(/~0/g, "~");
}

function getPointerParent(
  root: Record<string, unknown>,
  path: string,
): {
  parent: Record<string, unknown> | unknown[];
  key: string;
} {
  const tokens = path.split("/").slice(1).map(decodePointerToken);
  if (tokens.length === 0) {
    throw badRequest("Patch path must not target the root document directly.");
  }

  let current: Record<string, unknown> | unknown[] = root;
  for (const token of tokens.slice(0, -1)) {
    if (Array.isArray(current)) {
      const index = token === "-" ? current.length : Number.parseInt(token, 10);
      if (!Number.isInteger(index) || index < 0 || index >= current.length) {
        throw badRequest(`Patch path not found: ${path}`);
      }
      const next = current[index];
      if (!next || typeof next !== "object") {
        throw badRequest(`Patch path not found: ${path}`);
      }
      current = next as Record<string, unknown> | unknown[];
      continue;
    }

    const next = current[token];
    if (!next || typeof next !== "object") {
      throw badRequest(`Patch path not found: ${path}`);
    }
    current = next as Record<string, unknown> | unknown[];
  }

  return { parent: current, key: tokens[tokens.length - 1] ?? "" };
}

function readPointerValue(
  root: Record<string, unknown>,
  path: string,
): unknown {
  if (path === "") return root;
  const { parent, key } = getPointerParent(root, path);
  if (Array.isArray(parent)) {
    const index = key === "-" ? parent.length : Number.parseInt(key, 10);
    return parent[index];
  }
  return parent[key];
}

function applyPatchOperation(
  root: Record<string, unknown>,
  operation: JsonPatchOperation,
) {
  if (operation.path === "" && operation.op === "replace") {
    if (
      !operation.value ||
      typeof operation.value !== "object" ||
      Array.isArray(operation.value)
    ) {
      throw badRequest("Replacing the root document requires an object value.");
    }
    return structuredClone(operation.value) as Record<string, unknown>;
  }

  const { parent, key } = getPointerParent(root, operation.path);
  switch (operation.op) {
    case "add":
    case "replace": {
      if (Array.isArray(parent)) {
        const index = key === "-" ? parent.length : Number.parseInt(key, 10);
        const isValidReplaceIndex =
          operation.op === "replace"
            ? Number.isInteger(index) && index >= 0 && index < parent.length
            : Number.isInteger(index) && index >= 0 && index <= parent.length;
        if (!isValidReplaceIndex) {
          throw badRequest(`Invalid array patch path: ${operation.path}`);
        }
        if (operation.op === "replace") {
          parent[index] = operation.value;
        } else {
          parent.splice(index, 0, operation.value);
        }
      } else {
        parent[key] = operation.value;
      }
      return root;
    }
    case "remove": {
      if (Array.isArray(parent)) {
        const index = Number.parseInt(key, 10);
        if (!Number.isInteger(index) || index < 0 || index >= parent.length) {
          throw badRequest(`Invalid array patch path: ${operation.path}`);
        }
        parent.splice(index, 1);
      } else {
        delete parent[key];
      }
      return root;
    }
    case "copy": {
      if (!operation.from) throw badRequest("Patch copy requires a from path.");
      return applyPatchOperation(root, {
        op: "add",
        path: operation.path,
        value: structuredClone(readPointerValue(root, operation.from)),
      });
    }
    case "move": {
      if (!operation.from) throw badRequest("Patch move requires a from path.");
      const value = structuredClone(readPointerValue(root, operation.from));
      applyPatchOperation(root, { op: "remove", path: operation.from });
      return applyPatchOperation(root, {
        op: "add",
        path: operation.path,
        value,
      });
    }
    case "test": {
      const actual = readPointerValue(root, operation.path);
      if (!isDeepStrictEqual(actual, operation.value)) {
        throw conflict(`Patch test failed for path ${operation.path}.`);
      }
      return root;
    }
    default:
      throw badRequest(
        `Unsupported patch operation: ${sanitizeUnknown(operation.op)}`,
      );
  }
}

function normalizePatchedDocument(
  document: Record<string, unknown>,
): DesignResumeJson {
  return normalizeV5Document(document);
}

function isMissingDesignResumeTableError(error: unknown): boolean {
  const message = String((error as Error)?.message ?? error);
  return (
    message.includes("no such table") &&
    message.includes("design_resume_documents")
  );
}

async function ensureStorageDirs(): Promise<void> {
  if (!existsSync(DESIGN_RESUME_ASSET_DIR)) {
    await mkdir(DESIGN_RESUME_ASSET_DIR, { recursive: true });
  }
}

async function deleteAssetFile(storagePath: string): Promise<void> {
  try {
    await unlink(storagePath);
  } catch (error) {
    logger.warn("Failed to delete design resume asset", {
      storagePath,
      error: sanitizeUnknown(error),
    });
  }
}

async function clearDesignResumeAssetsForDocument(
  documentId: string,
): Promise<void> {
  const assets = await designResumeRepo.listDesignResumeAssets(documentId);
  if (assets.length === 0) return;

  await designResumeRepo.deleteDesignResumeAssetsForDocument(documentId);
  await Promise.all(
    assets.map(async (asset) => {
      await deleteAssetFile(asset.storagePath);
    }),
  );
}

export async function getCurrentDesignResume(): Promise<DesignResumeDocument | null> {
  try {
    return hydrateDocument(
      await designResumeRepo.getLatestDesignResumeDocument(),
    );
  } catch (error) {
    if (isMissingDesignResumeTableError(error)) {
      return null;
    }
    throw error;
  }
}

export async function requireCurrentDesignResume(): Promise<DesignResumeDocument> {
  const document = await getCurrentDesignResume();
  if (!document) {
    throw notFound("Design Resume has not been imported yet.");
  }
  return document;
}

export async function getDesignResumeStatus(): Promise<DesignResumeStatusResponse> {
  const document = await getCurrentDesignResume();
  return {
    exists: Boolean(document),
    documentId: document?.id ?? null,
    updatedAt: document?.updatedAt ?? null,
  };
}

export async function importDesignResumeFromReactiveResume(): Promise<DesignResumeDocument> {
  const existingDocument = await getCurrentDesignResume();
  const { resumeId } = await getConfiguredRxResumeBaseResumeId();
  if (!resumeId) {
    throw badRequest(
      "No base resume selected. Configure Reactive Resume and choose a template resume first.",
    );
  }

  const upstreamResume = await getResume(resumeId);
  if (!upstreamResume.data || typeof upstreamResume.data !== "object") {
    throw badRequest("Reactive Resume base resume is empty or invalid.");
  }

  const sourceMode = upstreamResume.mode ?? "v5";
  const normalized = normalizeImportedResume(upstreamResume.data, sourceMode);
  const now = new Date().toISOString();
  const saved = await designResumeRepo.upsertDesignResumeDocument({
    id: DESIGN_RESUME_DEFAULT_ID,
    title: buildDocumentTitle(normalized),
    resumeJson: normalized,
    revision: 1,
    sourceResumeId: resumeId,
    sourceMode,
    importedAt: now,
    updatedAt: now,
  });

  if (existingDocument?.id) {
    await clearDesignResumeAssetsForDocument(existingDocument.id);
  }

  return (await hydrateDocument(saved)) as DesignResumeDocument;
}

export async function updateCurrentDesignResume(
  input: DesignResumePatchRequest,
): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume();
  if (current.revision !== input.baseRevision) {
    throw conflict("Design Resume has changed. Refresh and try again.");
  }

  let nextDocument: Record<string, unknown>;
  if (input.document) {
    nextDocument = normalizePatchedDocument(
      structuredClone(input.document) as Record<string, unknown>,
    );
  } else if (input.operations && input.operations.length > 0) {
    nextDocument = structuredClone(current.resumeJson) as Record<
      string,
      unknown
    >;
    for (const operation of input.operations) {
      nextDocument = applyPatchOperation(nextDocument, operation);
    }
    nextDocument = normalizePatchedDocument(nextDocument);
  } else {
    throw badRequest(
      "Design Resume update requires a document or patch operations.",
    );
  }

  const now = new Date().toISOString();
  const saved = await designResumeRepo.upsertDesignResumeDocument({
    id: current.id,
    title: buildDocumentTitle(nextDocument),
    resumeJson: nextDocument,
    revision: current.revision + 1,
    sourceResumeId: current.sourceResumeId,
    sourceMode: current.sourceMode,
    importedAt: current.importedAt,
    updatedAt: now,
  });

  return (await hydrateDocument(saved)) as DesignResumeDocument;
}

export async function uploadDesignResumePicture(input: {
  fileName: string;
  dataUrl: string;
}): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume();
  await ensureStorageDirs();

  const parsed = parseDataUrl(input.dataUrl);
  const assetId = createId();
  const storagePath = join(
    DESIGN_RESUME_ASSET_DIR,
    `${assetId}${extensionForMimeType(parsed.mimeType)}`,
  );

  const existingAsset = await designResumeRepo.findDesignResumeAssetForDocument(
    {
      documentId: current.id,
      kind: "picture",
    },
  );

  const now = new Date().toISOString();
  try {
    await writeFile(storagePath, parsed.data);
    await designResumeRepo.insertDesignResumeAsset({
      id: assetId,
      documentId: current.id,
      kind: "picture",
      originalName: basename(
        input.fileName || `picture${extname(storagePath)}`,
      ),
      mimeType: parsed.mimeType,
      byteSize: parsed.data.byteLength,
      storagePath,
      updatedAt: now,
    });
  } catch (error) {
    await deleteAssetFile(storagePath);
    throw error;
  }

  const nextDocument = structuredClone(current.resumeJson) as Record<
    string,
    unknown
  >;
  const picture = asRecord(nextDocument.picture) ?? {};
  nextDocument.picture = {
    ...defaultPicture(),
    ...picture,
    url: contentUrlForAsset(assetId),
    show: true,
  };

  try {
    const updated = await updateCurrentDesignResume({
      baseRevision: current.revision,
      document: nextDocument,
    });

    if (existingAsset) {
      await designResumeRepo.deleteDesignResumeAsset(existingAsset.id);
      await deleteAssetFile(existingAsset.storagePath);
    }

    return updated;
  } catch (error) {
    await designResumeRepo.deleteDesignResumeAsset(assetId);
    await deleteAssetFile(storagePath);
    throw error;
  }
}

export async function deleteDesignResumePicture(): Promise<DesignResumeDocument> {
  const current = await requireCurrentDesignResume();
  const asset = await designResumeRepo.findDesignResumeAssetForDocument({
    documentId: current.id,
    kind: "picture",
  });
  if (asset) {
    await designResumeRepo.deleteDesignResumeAsset(asset.id);
    await deleteAssetFile(asset.storagePath);
  }

  const nextDocument = structuredClone(current.resumeJson) as Record<
    string,
    unknown
  >;
  const picture = asRecord(nextDocument.picture) ?? {};
  nextDocument.picture = {
    ...defaultPicture(),
    ...picture,
    url: "",
  };

  return updateCurrentDesignResume({
    baseRevision: current.revision,
    document: nextDocument,
  });
}

export async function readDesignResumeAssetContent(assetId: string): Promise<{
  asset: DesignResumeAsset;
  content: Buffer;
}> {
  const row = await designResumeRepo.getDesignResumeAssetById(assetId);
  if (!row) {
    throw notFound("Design Resume asset not found.");
  }

  const content = await readFile(row.storagePath);
  return {
    asset: toDesignResumeAsset(row),
    content,
  };
}

export async function exportDesignResume(): Promise<DesignResumeExportResponse> {
  const current = await requireCurrentDesignResume();
  const fileStem =
    buildDocumentTitle(current.resumeJson)
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "design-resume";

  return {
    fileName: `${fileStem}.json`,
    document: current.resumeJson,
  };
}

export async function designResumeToProfile(
  document?: DesignResumeJson | null,
): Promise<ResumeProfile | null> {
  const source = document ?? (await getCurrentDesignResume())?.resumeJson;
  if (!source) return null;

  const basics = asRecord(source.basics) ?? {};
  const summary = asRecord(source.summary) ?? {};
  const sections = asRecord(source.sections) ?? {};
  const skills = asRecord(sections.skills) ?? {};
  const projects = asRecord(sections.projects) ?? {};
  const experience = asRecord(sections.experience) ?? {};

  return {
    basics: {
      name: toText(basics.name),
      label: toText(basics.headline),
      headline: toText(basics.headline),
      email: toText(basics.email),
      phone: toText(basics.phone),
      url: toText(asRecord(basics.website)?.url),
      summary: toText(summary.content),
      location: {
        address: toText(basics.location),
      },
      profiles: asArray(profilesSection(source)?.items).map((item) => {
        const record = asRecord(item) ?? {};
        return {
          network: toText(record.network),
          username: toText(record.username),
          url: toText(asRecord(record.website)?.url),
        };
      }),
    },
    sections: {
      summary: {
        id: "summary",
        visible: !toBoolean(summary.hidden, false),
        name: toText(summary.title, "Summary"),
        content: toText(summary.content),
      },
      skills: {
        id: "skills",
        visible: !toBoolean(skills.hidden, false),
        name: toText(skills.title, "Skills"),
        items: asArray(skills.items).map((item) => {
          const record = asRecord(item) ?? {};
          return {
            id: toText(record.id, createId()),
            name: toText(record.name),
            description: toText(record.proficiency),
            level: toNumber(record.level, 1),
            keywords: asArray(record.keywords).map((value) => toText(value)),
            visible: !toBoolean(record.hidden, false),
          };
        }),
      },
      projects: {
        id: "projects",
        visible: !toBoolean(projects.hidden, false),
        name: toText(projects.title, "Projects"),
        items: asArray(projects.items).map((item) => {
          const record = asRecord(item) ?? {};
          return {
            id: toText(record.id, createId()),
            name: toText(record.name),
            description: toText(record.description),
            date: toText(record.period),
            summary: toText(record.description),
            visible: !toBoolean(record.hidden, false),
            keywords: asArray(record.technologies ?? record.keywords).map(
              (value) => toText(value),
            ),
            url: toText(asRecord(record.website)?.url),
          };
        }),
      },
      experience: {
        id: "experience",
        visible: !toBoolean(experience.hidden, false),
        name: toText(experience.title, "Experience"),
        items: asArray(experience.items).map((item) => {
          const record = asRecord(item) ?? {};
          return {
            id: toText(record.id, createId()),
            company: toText(record.company),
            position: toText(record.position),
            location: toText(record.location),
            date: toText(record.period),
            summary: toText(record.description),
            visible: !toBoolean(record.hidden, false),
          };
        }),
      },
    },
  };
}

function profilesSection(source: DesignResumeJson) {
  const sections = asRecord(source.sections) ?? {};
  return asRecord(sections.profiles) ?? {};
}

export async function getDesignResumeProjectProfile(): Promise<ResumeProfile | null> {
  return designResumeToProfile();
}

export async function statDesignResumeAssetFile(assetId: string) {
  const asset = await designResumeRepo.getDesignResumeAssetById(assetId);
  if (!asset) throw notFound("Design Resume asset not found.");
  const info = await stat(asset.storagePath);
  return { asset: toDesignResumeAsset(asset), info };
}
