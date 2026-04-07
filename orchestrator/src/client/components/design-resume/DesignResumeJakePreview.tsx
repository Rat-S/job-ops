import type { DesignResumeDocument } from "@shared/types";
import type React from "react";
import { cn } from "@/lib/utils";
import { asArray, asRecord, getByPath, toBoolean, toText } from "./utils";

type ContactItem = {
  text: string;
  url?: string | null;
};

type PreviewEntry = {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  date?: string;
  bullets: string[];
  url?: string | null;
};

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

function stripHtml(value: string): string {
  return decodeHtml(
    value
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/p>\s*<p[^>]*>/gi, "\n")
      .replace(/<\/li>\s*<li[^>]*>/gi, "\n")
      .replace(/<\/?[^>]+>/g, " "),
  )
    .replace(/\s*\n\s*/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

function extractBullets(value: unknown): string[] {
  if (typeof value !== "string" || !value.trim()) return [];

  const listItems = [...value.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)]
    .map((match) => stripHtml(match[1] ?? ""))
    .filter(Boolean);
  if (listItems.length > 0) return listItems;

  const cleaned = stripHtml(value);
  if (!cleaned) return [];
  return cleaned
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function renderContactItem(item: ContactItem) {
  if (!item.url) return <span>{item.text}</span>;
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="underline">
      {item.text}
    </a>
  );
}

function buildContacts(draft: DesignResumeDocument): ContactItem[] {
  const resumeJson = draft.resumeJson as Record<string, unknown>;
  const basics = (asRecord(resumeJson.basics) ?? {}) as Record<string, unknown>;
  const sections = (asRecord(resumeJson.sections) ?? {}) as Record<
    string,
    unknown
  >;
  const contacts: ContactItem[] = [];

  const phone = toText(basics.phone);
  if (phone) contacts.push({ text: phone });

  const email = toText(basics.email);
  if (email) contacts.push({ text: email, url: `mailto:${email}` });

  const websiteUrl = toText(getByPath(basics, "website.url"));
  const websiteLabel = toText(getByPath(basics, "website.label")) || websiteUrl;
  if (websiteUrl) contacts.push({ text: websiteLabel, url: websiteUrl });

  const profilesSection = (asRecord(sections.profiles) ?? {}) as Record<
    string,
    unknown
  >;
  const profileItems = asArray(profilesSection.items).map(
    (item) => asRecord(item) ?? {},
  ) as Record<string, unknown>[];
  for (const item of profileItems) {
    if (toBoolean(item.hidden, false)) continue;
    const url = toText(getByPath(item, "website.url"));
    const network = toText(item.network);
    const username = toText(item.username);
    const label = network || username || url;
    if (label) contacts.push({ text: label, url: url || undefined });
  }

  const customFields = asArray(basics.customFields).map(
    (item) => asRecord(item) ?? {},
  ) as Record<string, unknown>[];
  for (const field of customFields) {
    const text =
      toText(field.text) || toText(field.name) || toText(field.value);
    const link = toText(field.link);
    if (text) contacts.push({ text, url: link || undefined });
  }

  const seen = new Set<string>();
  return contacts.filter((item) => {
    const key = `${item.text}|${item.url ?? ""}`.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getSectionItems(
  draft: DesignResumeDocument,
  sectionKey: string,
): Record<string, unknown>[] {
  const resumeJson = draft.resumeJson as Record<string, unknown>;
  const sections = (asRecord(resumeJson.sections) ?? {}) as Record<
    string,
    unknown
  >;
  const section = (asRecord(sections[sectionKey]) ?? {}) as Record<
    string,
    unknown
  >;
  if (toBoolean(section.hidden, false)) return [];
  return asArray(section.items)
    .map((item) => asRecord(item) ?? {})
    .filter((item) => !toBoolean(item.hidden, false)) as Record<
    string,
    unknown
  >[];
}

function toExperienceEntries(draft: DesignResumeDocument): PreviewEntry[] {
  return getSectionItems(draft, "experience").map((item, index) => ({
    id: toText(item.id, `experience-${index}`),
    title: toText(item.company, "Untitled"),
    subtitle: toText(item.position),
    meta: toText(item.location),
    date: toText(item.period || item.date),
    bullets: extractBullets(item.description || item.summary),
    url: toText(getByPath(item, "website.url")) || undefined,
  }));
}

function toEducationEntries(draft: DesignResumeDocument): PreviewEntry[] {
  return getSectionItems(draft, "education").map((item, index) => ({
    id: toText(item.id, `education-${index}`),
    title: toText(item.school, "Untitled"),
    subtitle: [toText(item.degree), toText(item.area)]
      .filter(Boolean)
      .join(", "),
    meta: [toText(item.location), toText(item.grade)]
      .filter(Boolean)
      .join(" | "),
    date: toText(item.period || item.date),
    bullets: extractBullets(item.description || item.summary),
    url: toText(getByPath(item, "website.url")) || undefined,
  }));
}

function toProjectEntries(draft: DesignResumeDocument): PreviewEntry[] {
  return getSectionItems(draft, "projects").map((item, index) => {
    const tech = asArray(item.technologies ?? item.keywords)
      .map((value) => toText(value))
      .filter(Boolean)
      .join(", ");

    return {
      id: toText(item.id, `project-${index}`),
      title: toText(item.name, "Untitled"),
      subtitle: tech,
      date: toText(item.period || item.date),
      bullets: extractBullets(item.description || item.summary),
      url: toText(getByPath(item, "website.url")) || undefined,
    };
  });
}

function JakeSection({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-2">
      <div className="border-b border-black pb-1 text-[12px] font-bold uppercase tracking-[0.18em] text-black">
        {title}
      </div>
      {children}
    </section>
  );
}

function JakeEntryList({ entries }: { entries: PreviewEntry[] }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <article key={entry.id} className="space-y-1.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[14px] font-bold leading-tight text-black">
                {entry.url ? (
                  <a
                    href={entry.url}
                    target="_blank"
                    rel="noreferrer"
                    className="underline"
                  >
                    {entry.title}
                  </a>
                ) : (
                  entry.title
                )}
              </div>
              {entry.subtitle ? (
                <div className="text-[13px] italic leading-tight text-black">
                  {entry.subtitle}
                </div>
              ) : null}
              {entry.meta ? (
                <div className="text-[12px] leading-tight text-neutral-700">
                  {entry.meta}
                </div>
              ) : null}
            </div>
            {entry.date ? (
              <div className="shrink-0 text-[12px] font-medium text-neutral-700">
                {entry.date}
              </div>
            ) : null}
          </div>
          {entry.bullets.length > 0 ? (
            <ul className="space-y-1 pl-4 text-[12px] leading-[1.45] text-black">
              {entry.bullets.map((bullet) => (
                <li key={bullet} className="list-disc">
                  {bullet}
                </li>
              ))}
            </ul>
          ) : null}
        </article>
      ))}
    </div>
  );
}

export function DesignResumeJakePreview({
  draft,
  className,
}: {
  draft: DesignResumeDocument;
  className?: string;
}) {
  const resumeJson = draft.resumeJson as Record<string, unknown>;
  const basics = (asRecord(resumeJson.basics) ?? {}) as Record<string, unknown>;
  const summary = (asRecord(resumeJson.summary) ?? {}) as Record<
    string,
    unknown
  >;

  const contacts = buildContacts(draft);
  const experience = toExperienceEntries(draft);
  const education = toEducationEntries(draft);
  const projects = toProjectEntries(draft);
  const skills = getSectionItems(draft, "skills").map((item, index) => ({
    id: toText(item.id, `skill-${index}`),
    name: toText(item.name, "Skills"),
    keywords: asArray(item.keywords)
      .map((entry) => toText(entry))
      .filter(Boolean),
  }));

  return (
    <div
      className={cn(
        "flex h-full justify-center overflow-auto bg-muted/10 p-6 xl:p-8",
        className,
      )}
    >
      <div className="my-auto min-h-[980px] w-full max-w-[720px] rounded-[1.75rem] border border-border/70 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
        <div className="p-10 text-left font-['Georgia','Times_New_Roman',serif] xl:p-12">
          <div className="space-y-6 text-black">
            <header className="space-y-2 text-center">
              <h1 className="text-[34px] font-bold leading-none tracking-tight">
                {toText(basics.name, "Your Name")}
              </h1>
              {toText(basics.headline) ? (
                <p className="text-[14px] leading-tight text-neutral-800">
                  {toText(basics.headline)}
                </p>
              ) : null}
              {contacts.length > 0 ? (
                <div className="text-[12px] leading-tight text-neutral-800">
                  {contacts.map((item, index) => (
                    <span key={`${item.text}-${item.url ?? index}`}>
                      {renderContactItem(item)}
                      {index < contacts.length - 1 ? " | " : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </header>

            {!toBoolean(summary.hidden, false) && toText(summary.content) ? (
              <JakeSection title="Summary">
                <p className="text-[12px] leading-[1.5] text-black">
                  {stripHtml(toText(summary.content))}
                </p>
              </JakeSection>
            ) : null}

            {experience.length > 0 ? (
              <JakeSection title="Experience">
                <JakeEntryList entries={experience} />
              </JakeSection>
            ) : null}
            {education.length > 0 ? (
              <JakeSection title="Education">
                <JakeEntryList entries={education} />
              </JakeSection>
            ) : null}
            {projects.length > 0 ? (
              <JakeSection title="Projects">
                <JakeEntryList entries={projects} />
              </JakeSection>
            ) : null}
            {skills.length > 0 ? (
              <JakeSection title="Technical Skills">
                <div className="space-y-1 text-[12px] leading-[1.45] text-black">
                  {skills.map((group) => (
                    <p key={group.id}>
                      <span className="font-bold">{group.name}</span>
                      {group.keywords.length > 0
                        ? `: ${group.keywords.join(", ")}`
                        : ""}
                    </p>
                  ))}
                </div>
              </JakeSection>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
