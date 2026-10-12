import { timestampNow } from "@bufbuild/protobuf/wkt";
import { Code, ConnectError, createClient, type Client, type Interceptor, type Transport } from "@connectrpc/connect";
import { createConnectTransport } from "@connectrpc/connect-web";
import { type AuditEvent, AuditService } from "@/gen/forge/v1/audit_pb";
import { AuthService } from "@/gen/forge/v1/auth_pb";
import { ServiceCatalogService } from "@/gen/forge/v1/catalog_pb";
import { DeployService } from "@/gen/forge/v1/deploy_pb";
import { DocsService } from "@/gen/forge/v1/docs_pb";
import { EnvironmentService } from "@/gen/forge/v1/environment_pb";
import { OperationService } from "@/gen/forge/v1/operation_pb";
import { TeamService } from "@/gen/forge/v1/team_pb";
import { TemplateService } from "@/gen/forge/v1/template_pb";
import { loadSession } from "@/lib/auth/session";
import { apiUrl } from "@/lib/config";

// The dashboard is a thin client of the same API as the CLI: every call goes
// from the browser to forge-api with the reader's token, and the API decides.

export type Api = {
  auth: Client<typeof AuthService>;
  catalog: Client<typeof ServiceCatalogService>;
  deploys: Client<typeof DeployService>;
  environments: Client<typeof EnvironmentService>;
  templates: Client<typeof TemplateService>;
  teams: Client<typeof TeamService>;
  audit: Client<typeof AuditService>;
  operations: Client<typeof OperationService>;
  docs: Client<typeof DocsService>;
};

const bearer: Interceptor = (next) => async (req) => {
  const session = loadSession();
  if (session) req.header.set("Authorization", `Bearer ${session.token}`);
  return next(req);
};

export function webTransport(): Transport {
  return createConnectTransport({ baseUrl: apiUrl, interceptors: [bearer] });
}

// startForgeSession trades a fresh ID token for a Forge session of 7 days.
// It answers null when the API keeps no sessions.
export async function startForgeSession(idToken: string, label: string, transport?: Transport): Promise<{ token: string; expiresAt: number } | null> {
  const withLogin: Interceptor = (next) => async (req) => {
    req.header.set("Authorization", `Bearer ${idToken}`);
    return next(req);
  };
  const auth = createClient(AuthService, transport ?? createConnectTransport({ baseUrl: apiUrl, interceptors: [withLogin] }));
  try {
    const res = await auth.createSession({ label });
    const ends = res.session?.expireTime;
    if (!res.token || !ends) return null;
    return { token: res.token, expiresAt: Number(ends.seconds) * 1000 };
  } catch (err) {
    if (isCode(err, Code.Unimplemented)) return null;
    throw err;
  }
}

export function makeApi(transport: Transport): Api {
  return {
    auth: createClient(AuthService, transport),
    catalog: createClient(ServiceCatalogService, transport),
    deploys: createClient(DeployService, transport),
    environments: createClient(EnvironmentService, transport),
    templates: createClient(TemplateService, transport),
    teams: createClient(TeamService, transport),
    audit: createClient(AuditService, transport),
    operations: createClient(OperationService, transport),
    docs: createClient(DocsService, transport),
  };
}

export function isCode(err: unknown, code: Code): boolean {
  return ConnectError.from(err).code === code;
}

// errorText says what went wrong and what to do next, in the reader's words.
export function errorText(err: unknown): string {
  const e = ConnectError.from(err);
  switch (e.code) {
    case Code.PermissionDenied:
      return "You do not have access to this. Ask platform-engineering for access.";
    case Code.NotFound:
      return "This does not exist, or it was removed.";
    case Code.Unauthenticated:
      return "Your login has ended. Sign in again.";
    case Code.Unavailable:
    case Code.DeadlineExceeded:
      return "The Forge API cannot be reached. Try again in a moment.";
    case Code.Aborted:
      return "Someone changed this since the page loaded. Reload the page and try again.";
    default:
      return e.rawMessage || "Something went wrong. Try again.";
  }
}

// The API names things by kind ("services/payments", "templates/nextjs",
// "environments/pr-42", "operations/op_1d68e6ad2d75"); pages and addresses use
// the short name.
export function serviceId(name: string): string {
  return name.replace(/^services\//, "");
}
export function templateId(name: string): string {
  return name.replace(/^templates\//, "");
}
export function teamId(name: string): string {
  return name.replace(/^teams\//, "");
}
export function environmentId(name: string): string {
  return name.replace(/^environments\//, "");
}
export function operationId(name: string): string {
  return name.replace(/^operations\//, "");
}

// listAuditSince reads the audit log back to `ms` milliseconds ago, newest
// first, at most `pages` pages of 200. The log outlives a restart of the API,
// which a list of operations does not.
export async function listAuditSince(api: Api, ms: number, pages: number): Promise<AuditEvent[]> {
  const since = timestampNow();
  since.seconds -= BigInt(Math.floor(ms / 1000));
  const events: AuditEvent[] = [];
  let pageToken = "";
  for (let page = 0; page < pages; page++) {
    const res = await api.audit.listAuditEvents({ since, pageSize: 200, pageToken });
    events.push(...res.events);
    pageToken = res.nextPageToken;
    if (!pageToken) break;
  }
  return events;
}

// lastDay reads the audit log of the last 24 hours, which always covers today.
// A day of deploys fits in a few pages.
export function lastDay(api: Api): Promise<AuditEvent[]> {
  return listAuditSince(api, 24 * 3600_000, 5);
}

// listAllServices follows the pages of the catalog to its end.
export async function listAllServices(api: Api) {
  const all = [];
  let pageToken = "";
  do {
    const res = await api.catalog.listServices({ pageSize: 200, pageToken });
    all.push(...res.services);
    pageToken = res.nextPageToken;
  } while (pageToken);
  return all;
}
