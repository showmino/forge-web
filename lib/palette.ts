import type { Service } from "@/gen/forge/v1/catalog_pb";
import type { Environment } from "@/gen/forge/v1/environment_pb";
import type { Template } from "@/gen/forge/v1/template_pb";
import { environmentId, serviceId, templateId } from "@/lib/api";

// The command palette jumps to a page, a service, a template or a preview by
// name, and finds pages of the docs by what they say.

// line is a line of a docs page that holds the words searched for.
export type JumpItem = { label: string; href: string; kind: string; mono: boolean; line?: string };

export const PAGES: [label: string, href: string][] = [
  ["Overview", "/"],
  ["Services", "/services"],
  ["Templates", "/templates"],
  ["Docs", "/docs"],
  ["Create service", "/create"],
  ["Environments", "/environments"],
  ["Deployments", "/deployments"],
  ["Operations", "/operations"],
  ["Ownership", "/ownership"],
  ["Audit log", "/audit"],
];

export function jumpItems(services: Service[], previews: Environment[], templates: Template[] = []): JumpItem[] {
  return [
    ...PAGES.map(([label, href]) => ({ label, href, kind: "Page", mono: false })),
    ...services.map((s) => {
      const id = serviceId(s.name);
      return { label: id, href: `/services/${id}`, kind: s.ownerTeam ? `Service · ${s.ownerTeam}` : "Service", mono: true };
    }),
    ...templates.map((t) => {
      const id = templateId(t.name);
      return { label: id, href: `/templates/${encodeURIComponent(id)}`, kind: t.title ? `Template · ${t.title}` : "Template", mono: true };
    }),
    ...previews.map((e) => ({
      label: environmentId(e.name),
      href: `/services/${serviceId(e.service)}`,
      kind: `Preview · ${serviceId(e.service)}`,
      mono: true,
    })),
  ];
}

// filterJumps keeps the items whose name or kind holds the query, names that
// start with it first, at most `max`.
export function filterJumps(items: JumpItem[], query: string, max = 9): JumpItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items.slice(0, max);
  const starts: JumpItem[] = [];
  const holds: JumpItem[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    if (label.startsWith(q)) starts.push(item);
    else if (label.includes(q) || item.kind.toLowerCase().includes(q)) holds.push(item);
  }
  return [...starts, ...holds].slice(0, max);
}
