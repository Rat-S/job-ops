import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { logger } from "@infra/logger";
import { getTenantId } from "@infra/request-context";
import { getActiveTenantId } from "@server/tenancy/context";
import { getDataDir } from "@server/config/dataDir";
import type { ResumeProfile } from "@shared/types";
import { getResumeGenerationBackend } from "../config/resume-ops";
import {
  designResumeToProfile,
  isLegacyDesignResumeError,
} from "./design-resume";
import { getResume, RxResumeAuthConfigError } from "./rxresume";
import { getConfiguredRxResumeBaseResumeId } from "./rxresume/baseResumeId";

type TenantProfileCache = {
  profile: ResumeProfile | null;
  resumeId: string | null;
  localProfile: ResumeProfile | null;
  lastAccessedAt: number;
};

const PROFILE_CACHE_TTL_MS = 30 * 60 * 1000;
const PROFILE_CACHE_MAX_TENANTS = 100;
const profileCacheByTenant = new Map<string, TenantProfileCache>();

function pruneProfileCache(now = Date.now()): void {
  for (const [tenantId, cache] of profileCacheByTenant.entries()) {
    if (now - cache.lastAccessedAt > PROFILE_CACHE_TTL_MS) {
      profileCacheByTenant.delete(tenantId);
    }
  }

  while (profileCacheByTenant.size >= PROFILE_CACHE_MAX_TENANTS) {
    let oldestTenantId: string | null = null;
    let oldestAccessedAt = Number.POSITIVE_INFINITY;
    for (const [tenantId, cache] of profileCacheByTenant.entries()) {
      if (cache.lastAccessedAt < oldestAccessedAt) {
        oldestTenantId = tenantId;
        oldestAccessedAt = cache.lastAccessedAt;
      }
    }
    if (!oldestTenantId) return;
    profileCacheByTenant.delete(oldestTenantId);
  }
}

function getTenantProfileCache(): TenantProfileCache {
  const now = Date.now();
  pruneProfileCache(now);
  const tenantId = getActiveTenantId();
  let cache = profileCacheByTenant.get(tenantId);
  if (!cache) {
    cache = {
      profile: null,
      resumeId: null,
      localProfile: null,
      lastAccessedAt: now,
    };
    profileCacheByTenant.set(tenantId, cache);
  }
  cache.lastAccessedAt = now;
  return cache;
}

/**
 * Get the base resume profile from RxResume.
 *
 * Requires rxresumeBaseResumeId to be configured in settings.
 * Results are cached until clearProfileCache() is called.
 *
 * @param forceRefresh Force reload from API.
 * @throws Error if rxresumeBaseResumeId is not configured or API call fails.
 */
export async function getProfile(forceRefresh = false): Promise<ResumeProfile> {
  const cache = getTenantProfileCache();

  if (cache.localProfile && !forceRefresh) {
    return cache.localProfile;
  }

  const backend = getResumeGenerationBackend();
  if (backend === "resume_ops") {
    const localMaster = tryLoadLocalMasterResume();
    if (localMaster) {
      cache.localProfile = localMaster;
      return localMaster;
    }
  }

  try {
    const localProfile = await designResumeToProfile();
    if (localProfile) {
      cache.localProfile = localProfile;
      return localProfile;
    }
  } catch (error) {
    if (!isLegacyDesignResumeError(error)) {
      throw error;
    }
    logger.warn(
      "Ignoring legacy local Design Resume while loading profile fallback",
      {
        error,
      },
    );
  }

  let rxresumeBaseResumeId: string | null = null;
  try {
    const res = await getConfiguredRxResumeBaseResumeId();
    rxresumeBaseResumeId = res.resumeId;
  } catch (error) {
    // Ignore error getting rxresume configured ID
  }

  if (!rxresumeBaseResumeId) {
    const localMaster = tryLoadLocalMasterResume();
    if (localMaster) {
      cache.localProfile = localMaster;
      return localMaster;
    }
    throw new Error(
      "Base resume not configured. Please select a base resume from your RxResume account in Settings.",
    );
  }

  // Return cached profile if valid
  if (
    cache.profile &&
    cache.resumeId === rxresumeBaseResumeId &&
    !forceRefresh
  ) {
    return cache.profile;
  }

  try {
    logger.info("Fetching profile from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    const resume = forceRefresh
      ? await getResume(rxresumeBaseResumeId, { forceRefresh: true })
      : await getResume(rxresumeBaseResumeId);

    if (!resume.data || typeof resume.data !== "object") {
      throw new Error("Resume data is empty or invalid");
    }

    cache.profile = resume.data as unknown as ResumeProfile;
    cache.resumeId = rxresumeBaseResumeId;
    logger.info("Profile loaded from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
    });
    return cache.profile;
  } catch (error) {
    const localMaster = tryLoadLocalMasterResume();
    if (localMaster) {
      cache.localProfile = localMaster;
      return localMaster;
    }
    if (error instanceof RxResumeAuthConfigError) {
      throw new Error(error.message);
    }
    logger.error("Failed to load profile from Reactive Resume", {
      resumeId: rxresumeBaseResumeId,
      error,
    });
    throw error;
  }
}

/**
 * Get the person's name from the profile.
 */
export async function getPersonName(): Promise<string> {
  const profile = await getProfile();
  return profile?.basics?.name || "Resume";
}

/**
 * Clear the profile cache.
 */
export function clearProfileCache(): void {
  const tenantId = getTenantId();
  if (tenantId) {
    profileCacheByTenant.delete(tenantId);
    return;
  }
  profileCacheByTenant.clear();
}

export function __getProfileCacheSizeForTests(): number {
  return profileCacheByTenant.size;
}

export function tryLoadLocalMasterResume(): ResumeProfile | null {
  const candidates = [
    join(getDataDir(), "resume-ops", "master-resume.json"),
    join(process.cwd(), "..", "master-resume.json"),
    join(process.cwd(), "master-resume.json"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const raw = readFileSync(candidate, "utf8");
        const json = JSON.parse(raw);
        if (json && typeof json === "object") {
          logger.info(`Successfully loaded master-resume.json from ${candidate}`);
          return jsonResumeToProfile(json);
        }
      } catch (error) {
        logger.error(`Failed to parse master-resume.json from ${candidate}`, { error });
      }
    }
  }

  logger.warn("Could not find any local master-resume.json file");
  return null;
}

function jsonResumeToProfile(jsonResume: any): ResumeProfile {
  const basics = jsonResume.basics || {};
  const work = Array.isArray(jsonResume.work) ? jsonResume.work : [];
  const education = Array.isArray(jsonResume.education) ? jsonResume.education : [];
  const skills = Array.isArray(jsonResume.skills) ? jsonResume.skills : [];
  const projects = Array.isArray(jsonResume.projects) ? jsonResume.projects : [];

  return {
    basics: {
      name: typeof basics.name === "string" ? basics.name : "",
      label: typeof basics.label === "string" ? basics.label : "",
      headline: typeof basics.label === "string" ? basics.label : "",
      email: typeof basics.email === "string" ? basics.email : "",
      phone: typeof basics.phone === "string" ? basics.phone : "",
      url: typeof basics.url === "string" ? basics.url : "",
      summary: typeof basics.summary === "string" ? basics.summary : "",
      location: basics.location ? {
        address: typeof basics.location.address === "string" ? basics.location.address : "",
        postalCode: typeof basics.location.postalCode === "string" ? basics.location.postalCode : "",
        city: typeof basics.location.city === "string" ? basics.location.city : "",
        countryCode: typeof basics.location.countryCode === "string" ? basics.location.countryCode : "",
        region: typeof basics.location.region === "string" ? basics.location.region : "",
      } : undefined,
      profiles: Array.isArray(basics.profiles) ? basics.profiles.map((p: any) => ({
        network: typeof p.network === "string" ? p.network : "",
        username: typeof p.username === "string" ? p.username : "",
        url: typeof p.url === "string" ? p.url : "",
      })) : [],
    },
    sections: {
      summary: {
        id: "summary",
        visible: true,
        name: "Summary",
        content: typeof basics.summary === "string" ? basics.summary : "",
      },
      skills: {
        id: "skills",
        visible: true,
        name: "Skills",
        items: skills.map((s: any, idx: number) => ({
          id: s.id || `skill-${idx}`,
          name: typeof s.name === "string" ? s.name : "",
          description: typeof s.level === "string" ? s.level : "",
          level: 1,
          keywords: Array.isArray(s.keywords) ? s.keywords.map((k: any) => String(k)) : [],
          visible: true,
        })),
      },
      projects: {
        id: "projects",
        visible: true,
        name: "Projects",
        items: projects.map((p: any, idx: number) => {
          const mergedSummary = [
            typeof p.description === "string" ? p.description : "",
            ...(Array.isArray(p.highlights) ? p.highlights.map((h: any) => String(h)) : []),
          ].filter(Boolean).join("\n\n");
          return {
            id: p.id || `project-${idx}`,
            name: typeof p.name === "string" ? p.name : "",
            description: typeof p.description === "string" ? p.description : "",
            date: typeof p.period === "string" ? p.period : (typeof p.startDate === "string" ? p.startDate : ""),
            summary: mergedSummary,
            visible: true,
            keywords: Array.isArray(p.keywords) ? p.keywords.map((k: any) => String(k)) : [],
            url: typeof p.url === "string" ? p.url : "",
          };
        }),
      },
      experience: {
        id: "experience",
        visible: true,
        name: "Experience",
        items: work.map((w: any, idx: number) => {
          const mergedSummary = [
            typeof w.summary === "string" ? w.summary : "",
            ...(Array.isArray(w.highlights) ? w.highlights.map((h: any) => String(h)) : []),
          ].filter(Boolean).join("\n\n");
          return {
            id: w.id || `work-${idx}`,
            company: typeof w.name === "string" ? w.name : "",
            position: typeof w.position === "string" ? w.position : "",
            location: typeof w.location === "string" ? w.location : "",
            date: `${typeof w.startDate === "string" ? w.startDate : ""} - ${typeof w.endDate === "string" ? w.endDate : ""}`,
            summary: mergedSummary,
            visible: true,
          };
        }),
      },
    },
  };
}
