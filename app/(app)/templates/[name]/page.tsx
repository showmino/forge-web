"use client";

import { useQuery } from "@tanstack/react-query";
import { useParams } from "next/navigation";
import { useApi } from "@/components/providers";
import { Empty, ErrorNote, Facts, Loading, PageHeader, Panel, Section, TableFrame, td, th, tr } from "@/components/ui/layout";
import { TemplateParameter_Type, type TemplateParameter } from "@/gen/forge/v1/template_pb";

function typeText(p: TemplateParameter): string {
  switch (p.type) {
    case TemplateParameter_Type.INT:
      return "Number";
    case TemplateParameter_Type.BOOL:
      return "Yes or no";
    case TemplateParameter_Type.ENUM:
      return `One of ${p.values.join(", ")}`;
    default:
      return p.pattern ? `Text matching ${p.pattern}` : "Text";
  }
}

// One template: what it makes and what it asks for.
export default function TemplatePage() {
  const { name } = useParams<{ name: string }>();
  const api = useApi();
  const template = useQuery({
    queryKey: ["template", name],
    queryFn: () => api.templates.getTemplate({ name }).then((r) => r.template),
  });

  if (template.isPending) return <Loading what="the template" />;
  if (template.error) return <ErrorNote error={template.error} />;
  const t = template.data;
  if (!t) return <ErrorNote error={new Error("This template does not exist, or it was removed.")} />;

  return (
    <>
      <PageHeader title={t.title || t.name} lead={t.description} />
      <Panel className="p-6">
        <Facts
          items={[
            ["Template", <span key="n" className="type-code">{t.name}</span>],
            ["Version", <span key="v" className="type-code">{t.version || "–"}</span>],
            ["Tags", t.tags.join(", ") || "–"],
            ["Owner", t.owner || "–"],
            ["Start from it", <code key="c" className="type-code">forge create &lt;name&gt; --template {t.name}</code>],
          ]}
        />
      </Panel>
      <Section title="What it asks for">
        {t.parameters.length === 0 ? (
          <Empty>Nothing beyond the service&apos;s name and team.</Empty>
        ) : (
          <TableFrame label="Parameters">
            <thead>
              <tr>
                <th className={th}>Parameter</th>
                <th className={th}>Kind</th>
                <th className={th}>Needed</th>
                <th className={th}>Default</th>
                <th className={th}>What it is</th>
              </tr>
            </thead>
            <tbody>
              {t.parameters.map((p) => (
                <tr key={p.name} className={tr}>
                  <td className={`${td} type-code`}>{p.name}</td>
                  <td className={td}>{typeText(p)}</td>
                  <td className={td}>{p.required ? "Yes" : "No"}</td>
                  <td className={`${td} type-code`}>{p.defaultValue || "–"}</td>
                  <td className={`${td} whitespace-normal text-ink-muted`}>{p.description || "–"}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        )}
      </Section>
    </>
  );
}
