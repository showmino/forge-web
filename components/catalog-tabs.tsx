"use client";

import { useQuery } from "@tanstack/react-query";
import { useRole } from "@/components/app-shell";
import { useApi } from "@/components/providers";
import { PageTabs } from "@/components/ui/portal";
import { listAllServices } from "@/lib/api";

type Tab = "services" | "templates" | "resources" | "clusters";

// CatalogTabs joins the Catalog's pages: services, templates, resources and,
// for admins, clusters, each with how many there are.
export function CatalogTabs({ current }: { current: Tab }) {
  const api = useApi();
  const admin = useRole() === "Admin";
  const services = useQuery({ queryKey: ["services"], queryFn: () => listAllServices(api) });
  const templates = useQuery({ queryKey: ["templates"], queryFn: () => api.templates.listTemplates({}).then((r) => r.templates) });
  const resources = useQuery({ queryKey: ["resources", "all"], queryFn: () => api.resources.listResources({}).then((r) => r.resources), retry: false });
  const clusters = useQuery({
    queryKey: ["clusters"],
    queryFn: () => api.clusters.listClusters({}).then((r) => r.clusters),
    enabled: admin,
    retry: false,
  });
  return (
    <PageTabs
      label="Catalog"
      tabs={[
        { label: "Services", href: "/services", icon: "box", count: services.data?.length, current: current === "services" },
        { label: "Templates", href: "/templates", icon: "layers", count: templates.data?.length, current: current === "templates" },
        { label: "Resources", href: "/resources", icon: "db", count: resources.data?.length, current: current === "resources" },
        ...(admin ? [{ label: "Clusters", href: "/clusters", icon: "server" as const, count: clusters.data?.length, current: current === "clusters" }] : []),
      ]}
    />
  );
}
