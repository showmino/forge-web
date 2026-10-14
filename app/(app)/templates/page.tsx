"use client";

import { useQuery } from "@tanstack/react-query";
import { useCanWrite } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { ButtonLink, NameLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, Panel } from "@/components/ui/layout";
import { Tag } from "@/components/ui/status";
import { templateId } from "@/lib/api";
import { paramSummary } from "@/lib/params";

// mark is the short badge of a template card: "go-grpc" gives "GRPC", "nextjs" gives "NEXT".
function mark(id: string): string {
  const last = id.split("-").pop() ?? id;
  return last.slice(0, 4).toUpperCase();
}

// The templates a new service can start from, one card each.
export default function Templates() {
  const api = useApi();
  const canWrite = useCanWrite();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.templates.listTemplates({}).then((r) => r.templates),
  });

  return (
    <>
      <PageHeader
        title="Templates"
        lead="Golden paths owned by the platform team. CI, a Dockerfile and the deploy config come with every new service."
        cli="forge template list"
      />
      {templates.isPending ? (
        <Loading what="templates" />
      ) : templates.error ? (
        <ErrorNote error={templates.error} />
      ) : templates.data.length === 0 ? (
        <Empty>No templates. They live in the templates repository; add one there.</Empty>
      ) : (
        <ul aria-label="Templates" className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-4">
          {templates.data.map((t) => {
            const id = templateId(t.name);
            return (
              <li key={t.name} className="flex">
                <Panel className="flex w-full flex-col gap-3 p-6">
                  <div className="flex items-center gap-3">
                    <span
                      aria-hidden="true"
                      className="grid size-9 flex-none place-items-center rounded-md border border-line bg-surface-2 font-mono text-[12px] font-semibold text-fg-2"
                    >
                      {mark(id)}
                    </span>
                    <div className="min-w-0">
                      <NameLink href={`/templates/${id}`} className="!text-[15px] !font-semibold">
                        {id}
                      </NameLink>
                      <div className="text-[12.5px] text-fg-3">{t.title}</div>
                    </div>
                  </div>
                  {t.description ? <p className="text-[13.5px] text-fg-2">{t.description}</p> : null}
                  {t.tags.length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {t.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  ) : null}
                  <p className="text-[12.5px] text-fg-2">
                    {paramSummary(t.parameters)}
                    {t.parameters.some((p) => p.required)
                      ? `: ${t.parameters
                          .filter((p) => p.required)
                          .map((p) => p.label || p.name)
                          .join(", ")}`
                      : ""}
                  </p>
                  <div className="mt-auto flex items-center gap-3 pt-2 text-[12.5px] text-fg-3">
                    <span className="tabular-nums">
                      {t.version || "No release"}
                      {t.owner ? ` · ${t.owner}` : ""}
                    </span>
                    {canWrite ? (
                      <ButtonLink
                        kind="primary"
                        size="sm"
                        href={`/create?template=${encodeURIComponent(id)}`}
                        className="ml-auto"
                        aria-label={`Use template ${id}`}
                      >
                        Use template
                      </ButtonLink>
                    ) : null}
                  </div>
                </Panel>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}
