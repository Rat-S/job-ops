import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({
  getLatestDesignResumeDocument: vi.fn(),
  listDesignResumeAssets: vi.fn(),
  upsertDesignResumeDocument: vi.fn(),
  insertDesignResumeAsset: vi.fn(),
  deleteDesignResumeAssetsForDocument: vi.fn(),
  findDesignResumeAssetForDocument: vi.fn(),
  deleteDesignResumeAsset: vi.fn(),
}));

const fsMocks = vi.hoisted(() => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn(),
  stat: vi.fn(),
  unlink: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@server/repositories/design-resume", () => repo);
vi.mock("@server/config/dataDir", () => ({
  getDataDir: vi.fn(() => "/tmp/job-ops-test"),
}));
vi.mock("@paralleldrive/cuid2", () => ({
  createId: vi.fn(() => "asset-1"),
}));
vi.mock("@server/services/rxresume/baseResumeId", () => ({
  getConfiguredRxResumeBaseResumeId: vi.fn(),
}));
vi.mock("@server/services/rxresume", () => ({
  getResume: vi.fn(),
}));
vi.mock("@server/services/rxresume/schema/v4", () => ({
  parseV4ResumeData: vi.fn((input: unknown) => input),
}));
vi.mock("@server/services/rxresume/schema/v5", () => ({
  parseV5ResumeData: vi.fn((input: unknown) => input),
}));
vi.mock("node:fs", () => ({
  existsSync: vi.fn(() => true),
  default: {
    existsSync: vi.fn(() => true),
  },
}));
vi.mock("node:fs/promises", () => ({
  ...fsMocks,
  default: fsMocks,
}));

import { getResume } from "@server/services/rxresume";
import { getConfiguredRxResumeBaseResumeId } from "@server/services/rxresume/baseResumeId";
import {
  importDesignResumeFromReactiveResume,
  updateCurrentDesignResume,
  uploadDesignResumePicture,
} from "./design-resume";

function makeDocumentRow(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: "primary",
    title: "Test Resume",
    resumeJson: {
      picture: { url: "", show: true },
      basics: {
        name: "Test User",
        headline: "",
        email: "",
        phone: "",
        location: "",
        website: { label: "", url: "" },
        customFields: [],
      },
      summary: {
        title: "Summary",
        columns: 1,
        hidden: false,
        content: "",
      },
      sections: {
        profiles: { title: "Profiles", columns: 1, hidden: false, items: [] },
        experience: {
          title: "Experience",
          columns: 1,
          hidden: false,
          items: [],
        },
        education: {
          title: "Education",
          columns: 1,
          hidden: false,
          items: [],
        },
        projects: { title: "Projects", columns: 1, hidden: false, items: [] },
        skills: { title: "Skills", columns: 1, hidden: false, items: [] },
        languages: {
          title: "Languages",
          columns: 1,
          hidden: false,
          items: [],
        },
        interests: {
          title: "Interests",
          columns: 1,
          hidden: false,
          items: [],
        },
        awards: { title: "Awards", columns: 1, hidden: false, items: [] },
        certifications: {
          title: "Certifications",
          columns: 1,
          hidden: false,
          items: [],
        },
        publications: {
          title: "Publications",
          columns: 1,
          hidden: false,
          items: [],
        },
        volunteer: {
          title: "Volunteer",
          columns: 1,
          hidden: false,
          items: [],
        },
        references: {
          title: "References",
          columns: 1,
          hidden: false,
          items: [],
        },
      },
      customSections: [],
      metadata: {},
    },
    revision: 1,
    sourceResumeId: null,
    sourceMode: "v5",
    importedAt: null,
    createdAt: "2026-04-07T00:00:00.000Z",
    updatedAt: "2026-04-07T00:00:00.000Z",
    ...overrides,
  };
}

describe("design resume service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repo.getLatestDesignResumeDocument.mockResolvedValue(makeDocumentRow());
    repo.listDesignResumeAssets.mockResolvedValue([]);
    repo.upsertDesignResumeDocument.mockImplementation(async (input) =>
      makeDocumentRow({
        ...input,
        createdAt: "2026-04-07T00:00:00.000Z",
      }),
    );
    repo.findDesignResumeAssetForDocument.mockResolvedValue(null);
    repo.insertDesignResumeAsset.mockResolvedValue({ id: "asset-1" });
    vi.mocked(getConfiguredRxResumeBaseResumeId).mockResolvedValue({
      mode: "v5",
      resumeId: "rx-1",
    });
    vi.mocked(getResume).mockResolvedValue({
      id: "rx-1",
      mode: "v5",
      data: makeDocumentRow().resumeJson,
    } as never);
  });

  it("rejects replace patches that target a missing array index", async () => {
    await expect(
      updateCurrentDesignResume({
        baseRevision: 1,
        operations: [
          {
            op: "replace",
            path: "/sections/projects/items/0",
            value: { id: "p1" },
          },
        ],
      }),
    ).rejects.toThrow("Invalid array patch path");
  });

  it("preserves an explicit picture show flag during normalization", async () => {
    repo.getLatestDesignResumeDocument.mockResolvedValueOnce(
      makeDocumentRow({
        resumeJson: {
          ...makeDocumentRow().resumeJson,
          picture: { url: "", show: false, hidden: false },
        },
      }),
    );

    const updated = await updateCurrentDesignResume({
      baseRevision: 1,
      document: {
        ...makeDocumentRow().resumeJson,
        picture: { url: "", show: false, hidden: false },
      },
    });

    expect(
      (
        updated.resumeJson.picture as {
          show?: boolean;
        }
      ).show,
    ).toBe(false);
  });

  it("uses structural equality for patch test operations", async () => {
    await expect(
      updateCurrentDesignResume({
        baseRevision: 1,
        operations: [
          {
            op: "test",
            path: "/metadata",
            value: {},
          },
        ],
      }),
    ).resolves.toBeTruthy();
  });

  it("cleans up the uploaded file when picture asset insertion fails", async () => {
    repo.insertDesignResumeAsset.mockRejectedValue(
      new Error("db insert failed"),
    );

    await expect(
      uploadDesignResumePicture({
        fileName: "photo.png",
        dataUrl: `data:image/png;base64,${Buffer.from("hello").toString("base64")}`,
      }),
    ).rejects.toThrow("db insert failed");

    expect(fsMocks.unlink).toHaveBeenCalledWith(
      "/tmp/job-ops-test/design-resume/assets/asset-1.png",
    );
  });

  it("removes existing assets when re-importing from Reactive Resume", async () => {
    repo.listDesignResumeAssets
      .mockResolvedValueOnce([
        {
          id: "old-picture",
          documentId: "primary",
          kind: "picture",
          originalName: "old.png",
          mimeType: "image/png",
          byteSize: 123,
          storagePath: "/tmp/job-ops-test/design-resume/assets/old-picture.png",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([
        {
          id: "old-picture",
          documentId: "primary",
          kind: "picture",
          originalName: "old.png",
          mimeType: "image/png",
          byteSize: 123,
          storagePath: "/tmp/job-ops-test/design-resume/assets/old-picture.png",
          createdAt: "2026-04-07T00:00:00.000Z",
          updatedAt: "2026-04-07T00:00:00.000Z",
        },
      ])
      .mockResolvedValueOnce([]);

    await importDesignResumeFromReactiveResume();

    expect(repo.deleteDesignResumeAssetsForDocument).toHaveBeenCalledWith(
      "primary",
    );
    expect(fsMocks.unlink).toHaveBeenCalledWith(
      "/tmp/job-ops-test/design-resume/assets/old-picture.png",
    );
  });
});
