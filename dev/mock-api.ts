import { Code, ConnectError, type ConnectRouter } from "@connectrpc/connect";
import { timestampFromDate } from "@bufbuild/protobuf/wkt";
import { AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { CreateStep_State, Lifecycle, ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { Deployment_Health, Deployment_SyncStatus, DeployService } from "@/gen/forge/v1/deploy_pb";
import { DocsService } from "@/gen/forge/v1/docs_pb";
import { Environment_State, EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { TeamService } from "@/gen/forge/v1/team_pb";
import { TemplateParameter_Type, TemplateService } from "@/gen/forge/v1/template_pb";

// A self-contained stand-in for forge-api, for `npm run dev` without a real
// cluster or a GitHub login (see docs/development.md, "Run it without a
// login"). It answers every RPC the dashboard calls, with data that looks
// like the live API's, and keeps simple state in memory for the length of
// the dev server: a create, a deploy or a preview done here shows up in the
// lists that follow, until the server restarts.
//
// It is not a simulator: writes do not change what Argo CD would actually
// report, and every operation succeeds after a couple of seconds. Good
// enough to look at every page; not a replacement for the real API.

export function mockIdToken(): string {
  const part = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const claims = { sub: "ana", email: "ana@example.com", preferred_username: "ana", exp: Math.floor(Date.now() / 1000) + 3600 };
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

const ago = (minutes: number) => timestampFromDate(new Date(Date.now() - minutes * 60_000));
const fromNow = (minutes: number) => timestampFromDate(new Date(Date.now() + minutes * 60_000));

type Deployment = {
  name: string;
  service: string;
  env: string;
  health: Deployment_Health;
  sync: Deployment_SyncStatus;
  commit: string;
  version?: string;
  message?: string;
  deployedBy?: string;
  deployTime?: ReturnType<typeof ago>;
  url?: string;
  argoUrl?: string;
};

type Service = {
  name: string;
  displayName?: string;
  ownerTeam: string;
  owners: string[];
  lifecycle: Lifecycle;
  repoUrl: string;
  dependencies: string[];
  updateTime: ReturnType<typeof ago>;
  createTime: ReturnType<typeof ago>;
};

type Preview = {
  name: string;
  service: string;
  ref: string;
  creator: string;
  state: Environment_State;
  url?: string;
  commit?: string;
  expireTime: ReturnType<typeof fromNow>;
};

type Op = { name: string; kind: string; target: string; creator: string; createTime: ReturnType<typeof ago>; done?: boolean; endTime?: ReturnType<typeof ago>; error?: { code: string; message: string } };

const COMMIT = "18b12326d3df2c1a11b9f664f378b579eb472aaf";
const OLD_COMMIT = "57e0013a9b2c1a11b9f664f378b579eb472aaf0";

// mockRoutes builds a fresh world each time it is called -- once, when
// Providers makes the transport -- so a page reload starts the demo over.
export function mockRoutes(router: ConnectRouter) {
  const services: Service[] = [
    {
      name: "services/payments",
      displayName: "Payments",
      ownerTeam: "platform-engineering",
      owners: ["ana@example.com"],
      lifecycle: Lifecycle.PRODUCTION,
      repoUrl: "https://github.com/showmino/payments",
      dependencies: [],
      updateTime: ago(12),
      createTime: ago(60 * 24 * 40),
    },
    {
      name: "services/checkout-api",
      ownerTeam: "commerce",
      owners: ["bo@example.com"],
      lifecycle: Lifecycle.PRODUCTION,
      repoUrl: "https://github.com/showmino/checkout-api",
      dependencies: ["services/payments"],
      updateTime: ago(31),
      createTime: ago(60 * 24 * 90),
    },
    {
      name: "services/search-indexer",
      ownerTeam: "discovery",
      owners: ["cho@example.com"],
      lifecycle: Lifecycle.EXPERIMENTAL,
      repoUrl: "https://github.com/showmino/search-indexer",
      dependencies: [],
      updateTime: ago(5 * 60),
      createTime: ago(60 * 24 * 10),
    },
    {
      name: "services/ledger",
      ownerTeam: "billing",
      owners: ["ana@example.com", "bo@example.com"],
      lifecycle: Lifecycle.PRODUCTION,
      repoUrl: "https://github.com/showmino/ledger",
      dependencies: [],
      updateTime: ago(3 * 60),
      createTime: ago(60 * 24 * 200),
    },
  ];

  const deployments: Deployment[] = [
    { name: "deployments/payments/staging", service: "services/payments", env: "staging", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployedBy: "ana@example.com", deployTime: ago(12), url: "https://payments-staging.example.com", argoUrl: "https://argocd.example.com/applications/argocd/payments-staging" },
    { name: "deployments/payments/production", service: "services/payments", env: "production", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployedBy: "ana@example.com", deployTime: ago(24 * 60), url: "https://payments.example.com", argoUrl: "https://argocd.example.com/applications/argocd/payments-production" },
    { name: "deployments/checkout-api/staging", service: "services/checkout-api", env: "staging", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployTime: ago(31), url: "https://checkout-api-staging.example.com" },
    { name: "deployments/checkout-api/production", service: "services/checkout-api", env: "production", health: Deployment_Health.DEGRADED, sync: Deployment_SyncStatus.SYNCED, commit: OLD_COMMIT, message: "1 of 3 pods is crash-looping", deployTime: ago(24 * 60 * 2), url: "https://checkout-api.example.com" },
    { name: "deployments/search-indexer/staging", service: "services/search-indexer", env: "staging", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployTime: ago(5 * 60), url: "https://search-indexer-staging.example.com" },
    { name: "deployments/ledger/staging", service: "services/ledger", env: "staging", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployTime: ago(3 * 60), url: "https://ledger-staging.example.com" },
    { name: "deployments/ledger/production", service: "services/ledger", env: "production", health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployTime: ago(3 * 60), url: "https://ledger.example.com" },
  ];

  const previews: Preview[] = [{ name: "environments/pr-42", service: "services/payments", ref: "feature/refunds", creator: "ana@example.com", state: Environment_State.READY, url: "https://pr-42.preview.example.com", commit: COMMIT, expireTime: fromNow(2 * 60) }];

  const audit = [
    { name: "auditEvents/9", time: ago(5), action: "deploy.promote", kind: "outcome", service: "services/payments", target: "deployments/payments/production", actor: { kind: "user", email: "ana@example.com" }, result: { code: "ok" } },
    { name: "auditEvents/8", time: ago(31), action: "deploy.start", kind: "outcome", service: "services/checkout-api", target: "deployments/checkout-api/staging", actor: { kind: "workload", repository: "showmino/checkout-api" }, result: { code: "ok" } },
    { name: "auditEvents/7", time: ago(5 * 60), action: "deploy.start", kind: "outcome", service: "services/search-indexer", target: "deployments/search-indexer/staging", actor: { kind: "workload", repository: "showmino/search-indexer" }, result: { code: "ok" } },
    { name: "auditEvents/6", time: ago(10 * 60), action: "environment.create", kind: "outcome", service: "services/payments", target: "environments/pr-42", actor: { kind: "user", email: "ana@example.com" }, result: { code: "ok" } },
    { name: "auditEvents/5", time: ago(24 * 60), action: "deploy.promote", kind: "outcome", service: "services/checkout-api", target: "deployments/checkout-api/production", actor: { kind: "user", email: "bo@example.com" }, result: { code: "failed", message: "sync_timeout: Argo CD did not report the application healthy in 10m0s" } },
    { name: "auditEvents/4", time: ago(3 * 60), action: "deploy.promote", kind: "outcome", service: "services/ledger", target: "deployments/ledger/production", actor: { kind: "user", email: "ana@example.com" }, result: { code: "ok" } },
  ];

  const running = new Map<string, Op>();
  const ended = new Map<string, Op>();
  let seq = 0;
  const nextId = () => `op_mock${String(++seq).padStart(8, "0")}`;

  // startOp runs an operation for a couple of seconds, then resolves done.
  function startOp(kind: string, target: string): Op {
    const op: Op = { name: `operations/${nextId()}`, kind, target, creator: "ana@example.com", createTime: ago(0) };
    running.set(op.name, op);
    setTimeout(() => {
      running.delete(op.name);
      ended.set(op.name, { ...op, done: true, endTime: ago(0) });
    }, 2500);
    return op;
  }

  router.service(AuthService, {
    getStatus: () => ({ subject: "ana", permissions: ["services.read", "services.write"], admin: true, teams: [] }),
    testPermissions: () => ({ allowed: ["service.create", "service.create.any_team", "service.update", "service.update.team", "service.register", "service.delete", "service.address", "deploy.start", "deploy.promote", "deploy.rollback", "environment.create", "environment.extend", "environment.destroy", "operation.cancel", "resource.plan", "resource.apply", "resource.apply.production"], role: "admin" }),
    deleteSession: () => ({}),
  });

  router.service(ServiceCatalogService, {
    listServices: () => ({ services }),
    getService: (req) => {
      const s = services.find((x) => x.name === req.name);
      if (!s) throw new ConnectError(`${req.name} not found`, Code.NotFound);
      return { service: { ...s, etag: `W/"${s.updateTime.seconds}"` } };
    },
    updateService: (req) => {
      const s = services.find((x) => x.name === req.service?.name);
      if (!s) throw new ConnectError("not found", Code.NotFound);
      Object.assign(s, req.service, { updateTime: ago(0) });
      return { service: { ...s, etag: `W/"${Date.now()}"` } };
    },
    deleteService: (req) => {
      const i = services.findIndex((x) => x.name === req.name);
      if (i >= 0) services.splice(i, 1);
      return {};
    },
    async *createService(req) {
      yield { event: { case: "step" as const, value: { name: "fetch", state: CreateStep_State.STARTED } } };
      await sleep(300);
      yield { event: { case: "step" as const, value: { name: "fetch", state: CreateStep_State.DONE, detail: `${req.template.replace("templates/", "")}@v1.3.1` } } };
      yield { event: { case: "step" as const, value: { name: "create_repo", state: CreateStep_State.STARTED } } };
      await sleep(400);
      const name = `services/${req.serviceId}`;
      yield { event: { case: "step" as const, value: { name: "create_repo", state: CreateStep_State.DONE, detail: `github.com/showmino/${req.serviceId}` } } };
      services.push({
        name,
        ownerTeam: req.ownerTeam || "platform-engineering",
        owners: ["ana@example.com"],
        lifecycle: Lifecycle.EXPERIMENTAL,
        repoUrl: `https://github.com/showmino/${req.serviceId}`,
        dependencies: [],
        updateTime: ago(0),
        createTime: ago(0),
      });
      yield { event: { case: "service" as const, value: { name, repoUrl: `https://github.com/showmino/${req.serviceId}` } } };
    },
  });

  router.service(DeployService, {
    listDomains: () => ({ domains: [{ name: "showmino.com", isDefault: true }, { name: "example.com", isDefault: false }], internalDomain: "10.0.0.1.nip.io" }),
    listDeployments: (req) => ({ deployments: deployments.filter((d) => !req.service || d.service === req.service) }),
    listDeployHistory: (req) => {
      const [, svc, env] = /^deployments\/([^/]+)\/([^/]+)$/.exec(req.name) ?? [];
      const d = deployments.find((x) => x.service === `services/${svc}` && x.env === env);
      if (!d?.commit) throw new ConnectError("nothing deployed there yet", Code.NotFound);
      return { records: [{ deployCommit: "c1", kind: "deploy", commit: d.commit, version: d.version, actor: d.deployedBy || "ana@example.com", time: d.deployTime }] };
    },
    startDeploy: (req) => {
      const env = req.env || "staging";
      const op = startOp("deploy", `deployments/${req.service.replace("services/", "")}/${env}`);
      const d = deployments.find((x) => x.service === req.service && x.env === env);
      if (d) Object.assign(d, { health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: COMMIT, deployTime: ago(0), deployedBy: "ana@example.com" });
      return { operation: op };
    },
    promoteDeploy: (req) => {
      const staging = deployments.find((x) => x.service === req.service && x.env === (req.from || "staging"));
      const to = req.to || "production";
      if (req.validateOnly) return { deployment: { name: `deployments/${req.service.replace("services/", "")}/${to}`, env: to, commit: staging?.commit ?? "", image: "" } };
      const op = startOp("promote", `deployments/${req.service.replace("services/", "")}/${to}`);
      const prod = deployments.find((x) => x.service === req.service && x.env === to);
      if (prod && staging) Object.assign(prod, { health: Deployment_Health.HEALTHY, sync: Deployment_SyncStatus.SYNCED, commit: staging.commit, deployTime: ago(0), deployedBy: "ana@example.com" });
      return { operation: op };
    },
    rollbackDeploy: (req) => ({ operation: startOp("rollback", req.name) }),
    setAddress: (req) => {
      const s = services.find((x) => x.name === req.service);
      return { service: s, addresses: [{ env: "staging", url: `https://${req.host || "staging"}.${req.domain || "example.com"}`, public: true, host: req.host }, { env: "production", url: `https://${req.domain || "example.com"}`, public: true, host: req.host }] };
    },
  });

  router.service(EnvironmentService, {
    listEnvironments: (req) => ({ environments: previews.filter((e) => !req.service || e.service === req.service) }),
    createEnvironment: (req) => {
      const op = startOp("create_environment", `environments/${req.environmentId}`);
      const ttlMinutes = req.ttl?.seconds ? Number(req.ttl.seconds) / 60 : 48 * 60;
      previews.push({ name: `environments/${req.environmentId}`, service: req.service, ref: req.ref || "main", creator: "ana@example.com", state: Environment_State.CREATING, expireTime: fromNow(ttlMinutes) });
      setTimeout(() => {
        const e = previews.find((x) => x.name === `environments/${req.environmentId}`);
        if (e) Object.assign(e, { state: Environment_State.READY, url: `https://${req.environmentId}.preview.example.com`, commit: COMMIT });
      }, 2500);
      return { operation: op };
    },
    extendEnvironment: (req) => {
      const e = previews.find((x) => x.name === req.name);
      if (e) e.expireTime = fromNow(48 * 60);
      return { environment: e };
    },
    destroyEnvironment: (req) => {
      const op = startOp("destroy_environment", req.name);
      setTimeout(() => {
        const i = previews.findIndex((x) => x.name === req.name);
        if (i >= 0) previews.splice(i, 1);
      }, 2500);
      return { operation: op };
    },
  });

  router.service(AuditService, { listAuditEvents: (req) => ({ events: audit.filter((e) => !req.service || e.service === req.service) }) });

  router.service(TeamService, {
    listTeams: () => ({
      teams: [
        { name: "teams/platform-engineering", displayName: "Platform Engineering" },
        { name: "teams/commerce", displayName: "Commerce" },
        { name: "teams/discovery", displayName: "Discovery" },
        { name: "teams/billing", displayName: "Billing" },
      ],
    }),
  });

  router.service(TemplateService, {
    listTemplates: () => ({
      templates: [
        { name: "templates/nextjs", version: "v1.3.1", title: "Next.js web app", description: "Server-rendered Next.js app with CI, Dockerfile and forge.yaml", tags: ["typescript", "web"], owner: "platform", parameters: [{ name: "port", type: TemplateParameter_Type.INT, defaultValue: "3000", description: "Port the server listens on" }] },
        { name: "templates/go-grpc", version: "v1.3.1", title: "ConnectRPC service", description: "A Go ConnectRPC service with CI, Dockerfile and forge.yaml", tags: ["go"], owner: "platform" },
      ],
    }),
    getTemplate: (req) => {
      if (req.name !== "templates/nextjs" && req.name !== "templates/go-grpc") throw new ConnectError(`name "${req.name}" must look like templates/{template}`, Code.InvalidArgument);
      return { template: { name: req.name, version: "v1.3.1", title: req.name === "templates/nextjs" ? "Next.js web app" : "ConnectRPC service", description: "", owner: "platform", parameters: [] } };
    },
  });

  const docPages: Record<string, { title: string; markdown: string }> = {
    "index.md": {
      title: "Payments",
      markdown:
        "# Payments\n\nCharges, refunds and payouts for every checkout.\n\nSee the [runbook](runbook.md) for on-call steps.\n\n## How a charge flows\n\n" +
        "```mermaid\nflowchart LR\n  checkout[checkout-api] --> payments\n  payments --> ledger\n  payments --> psp[(card network)]\n```\n",
    },
    "runbook.md": { title: "Runbook", markdown: "# Runbook\n\nHow to roll back a bad deploy.\n\n## Refunds stuck\n\nRestart the refund worker, then check the ledger.\n" },
  };
  router.service(DocsService, {
    getDocSet: (req) => {
      if (req.service !== "services/payments") throw new ConnectError(`${req.service} has no docs`, Code.NotFound);
      return { docSet: { service: req.service, branch: "main", pages: Object.entries(docPages).map(([path, p]) => ({ path, title: p.title })) } };
    },
    getDocPage: (req) => {
      const path = req.path || "index.md";
      const p = docPages[path];
      if (!p) throw new ConnectError(`${req.service} has no page docs/${path}`, Code.NotFound);
      return { page: { service: req.service, path, title: p.title, markdown: p.markdown } };
    },
    listDocSets: () => ({ docSets: [{ service: "services/payments", ownerTeam: "platform-engineering", branch: "main", pageCount: 2, changeTime: ago(60) }] }),
    getDocAsset: () => {
      throw new ConnectError("no such asset", Code.NotFound);
    },
    searchDocs: (req) => {
      const terms = [...new Set(req.query.toLowerCase().split(/\s+/).filter(Boolean))];
      if (terms.length === 0) throw new ConnectError("query is empty: name the words to look for", Code.InvalidArgument);
      const results = Object.entries(docPages).flatMap(([path, p]) => {
        const text = `${p.title}\n${p.markdown}`.toLowerCase();
        if (!terms.every((t) => text.includes(t))) return [];
        const lines = p.markdown
          .split("\n")
          .map((text, i) => ({ number: i + 1, text }))
          .filter((l) => terms.some((t) => l.text.toLowerCase().includes(t)))
          .slice(0, 3);
        return [{ service: "services/payments", path, title: p.title, lines }];
      });
      return { results, totalSize: results.length };
    },
  });

  router.service(OperationService, {
    listOperations: (req) => ({ operations: req.running ? [...running.values()] : [...running.values(), ...ended.values()] }),
    getOperation: (req) => {
      const op = running.get(req.name) ?? ended.get(req.name);
      if (!op) throw new ConnectError("not found", Code.NotFound);
      return { operation: op };
    },
    async *watchOperation(req) {
      yield { kind: { case: "event" as const, value: { time: ago(0), step: "render", message: "Rendered the manifests" } } };
      await sleep(500);
      yield { kind: { case: "event" as const, value: { time: ago(0), step: "sync", message: "Waiting for the rollout: 1 of 2 pods ready" } } };
      while (running.has(req.name)) await sleep(200);
      const op = ended.get(req.name) ?? { name: req.name, kind: "deploy", target: "", creator: "ana@example.com", createTime: ago(0), done: true, endTime: ago(0) };
      yield { kind: { case: "operation" as const, value: op } };
    },
    cancelOperation: (req) => {
      const op = running.get(req.name);
      running.delete(req.name);
      const done = { ...(op ?? { name: req.name, kind: "deploy", target: "", creator: "ana@example.com", createTime: ago(0) }), done: true, endTime: ago(0), error: { code: "cancelled", message: "cancelled" } };
      ended.set(req.name, done);
      return { operation: done };
    },
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
