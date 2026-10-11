"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/components/providers";
import { TextLink } from "@/components/ui/button";
import { Empty, ErrorNote, Loading, PageHeader, TableFrame, td, th, tr } from "@/components/ui/layout";

// The templates a new service can start from.
export default function Templates() {
  const api = useApi();
  const templates = useQuery({
    queryKey: ["templates"],
    queryFn: () => api.templates.listTemplates({}).then((r) => r.templates),
  });

  return (
    <>
      <PageHeader title="Templates" lead="The golden paths a new service starts from." />
      {templates.isPending ? (
        <Loading what="templates" />
      ) : templates.error ? (
        <ErrorNote error={templates.error} />
      ) : templates.data.length === 0 ? (
        <Empty>No templates. They live in the templates repository; add one there.</Empty>
      ) : (
        <TableFrame label="Templates">
          <thead>
            <tr>
              <th className={th}>Template</th>
              <th className={th}>What it makes</th>
              <th className={th}>Version</th>
              <th className={th}>Tags</th>
              <th className={th}>Owner</th>
            </tr>
          </thead>
          <tbody>
            {templates.data.map((t) => (
              <tr key={t.name} className={tr}>
                <td className={td}>
                  <TextLink href={`/templates/${t.name}`} className="type-code">
                    {t.name}
                  </TextLink>
                </td>
                <td className={`${td} whitespace-normal`}>
                  <span className="type-body-strong">{t.title}</span>
                  {t.description ? <span className="block text-ink-muted">{t.description}</span> : null}
                </td>
                <td className={`${td} type-code`}>{t.version || "–"}</td>
                <td className={`${td} text-ink-muted`}>{t.tags.join(", ") || "–"}</td>
                <td className={td}>{t.owner || "–"}</td>
              </tr>
            ))}
          </tbody>
        </TableFrame>
      )}
    </>
  );
}
