import { buildDesignResumeJakeDocument } from "@shared/design-resume-jake";
import type {
  DesignResumeDocument,
  DesignResumeJakeDocument,
  DesignResumeJakeEntry,
} from "@shared/types";
import type React from "react";
import { cn } from "@/lib/utils";

function renderContactItem(item: DesignResumeJakeDocument["contacts"][number]) {
  if (!item.url) return <span>{item.text}</span>;
  return (
    <a href={item.url} target="_blank" rel="noreferrer" className="underline">
      {item.text}
    </a>
  );
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

function JakeLinkedTitle({
  title,
  url,
}: {
  title: string;
  url?: string | null;
}) {
  if (!url) return <>{title}</>;
  return (
    <a href={url} target="_blank" rel="noreferrer" className="underline">
      {title}
    </a>
  );
}

function JakeEntryList({ entries }: { entries: DesignResumeJakeEntry[] }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <article key={entry.id} className="space-y-1.5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-[14px] font-bold leading-tight text-black">
                <JakeLinkedTitle title={entry.title} url={entry.url} />
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
              {entry.bullets.map((bullet, index) => (
                <li key={`${entry.id}-bullet-${index}`} className="list-disc">
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

function JakeProjectList({ entries }: { entries: DesignResumeJakeEntry[] }) {
  return (
    <div className="space-y-4">
      {entries.map((entry) => (
        <article key={entry.id} className="space-y-1.5">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-6">
            <div className="min-w-0 break-words text-[12px] leading-tight text-black">
              <span className="font-bold">
                <JakeLinkedTitle title={entry.title} url={entry.url} />
              </span>
              {entry.subtitle ? (
                <span className="italic">{` | ${entry.subtitle}`}</span>
              ) : null}
            </div>
            {entry.date ? (
              <div className="pl-4 text-right text-[12px] text-neutral-700">
                {entry.date}
              </div>
            ) : null}
          </div>
          {entry.bullets.length > 0 ? (
            <ul className="space-y-1 pl-4 text-[12px] leading-[1.45] text-black">
              {entry.bullets.map((bullet, index) => (
                <li key={`${entry.id}-bullet-${index}`} className="list-disc">
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
  const document = buildDesignResumeJakeDocument(
    draft.resumeJson as Record<string, unknown>,
  );

  return (
    <div
      className={cn(
        "flex h-full justify-center overflow-auto bg-muted/10 p-6 xl:p-8",
        className,
      )}
    >
      <div className="my-auto min-h-[980px] w-[720px] min-w-[720px] flex-none rounded-[1.75rem] border border-border/70 bg-white shadow-[0_24px_80px_rgba(0,0,0,0.24)]">
        <div className="p-10 text-left font-['Georgia','Times_New_Roman',serif] xl:p-12">
          <div className="space-y-6 text-black">
            <header className="space-y-2 text-center">
              <h1 className="text-[34px] font-bold leading-none tracking-tight">
                {document.name}
              </h1>
              {document.headline ? (
                <p className="text-[14px] leading-tight text-neutral-800">
                  {document.headline}
                </p>
              ) : null}
              {document.contacts.length > 0 ? (
                <div className="text-[12px] leading-tight text-neutral-800">
                  {document.contacts.map((item, index) => (
                    <span key={`${item.text}-${item.url ?? index}`}>
                      {renderContactItem(item)}
                      {index < document.contacts.length - 1 ? " | " : ""}
                    </span>
                  ))}
                </div>
              ) : null}
            </header>

            {document.summary ? (
              <JakeSection title="Summary">
                <p className="text-[12px] leading-[1.5] text-black">
                  {document.summary}
                </p>
              </JakeSection>
            ) : null}

            {document.experience.length > 0 ? (
              <JakeSection title="Experience">
                <JakeEntryList entries={document.experience} />
              </JakeSection>
            ) : null}
            {document.education.length > 0 ? (
              <JakeSection title="Education">
                <JakeEntryList entries={document.education} />
              </JakeSection>
            ) : null}
            {document.projects.length > 0 ? (
              <JakeSection title="Projects">
                <JakeProjectList entries={document.projects} />
              </JakeSection>
            ) : null}
            {document.skills.length > 0 ? (
              <JakeSection title="Technical Skills">
                <div className="space-y-1 text-[12px] leading-[1.45] text-black">
                  {document.skills.map((group) => (
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
