import { createRouterTransport, type ConnectRouter } from "@connectrpc/connect";
import { render } from "@testing-library/react";
import type { ReactNode } from "react";
import { Providers } from "@/components/providers";
import { saveSession } from "@/lib/auth/session";

// idToken makes an unsigned token with the claims the dashboard reads. The
// dashboard never verifies a token (forge-api does), so no signature is needed.
export function idToken(claims: Record<string, unknown>): string {
  const part = (v: unknown) => btoa(JSON.stringify(v)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  return `${part({ alg: "RS256" })}.${part(claims)}.signature`;
}

// signIn puts a login that lasts an hour into this tab.
export function signIn(email = "ana@example.com") {
  saveSession(idToken({ sub: "ana", email, exp: Math.floor(Date.now() / 1000) + 3600 }));
}

// renderWithApi renders a page against an in-memory Forge API.
export function renderWithApi(ui: ReactNode, routes: (router: ConnectRouter) => void) {
  return render(<Providers transport={createRouterTransport(routes)}>{ui}</Providers>);
}

// Who calls the fake API: an admin may do everything, a member of a team
// works on the services the team owns, and anyone else only reads.
export type Caller = { admin?: boolean; teams?: readonly string[] };
export const ADMIN: Caller = { admin: true, teams: [] };
export const READER: Caller = { teams: [] };

// The API's role table (internal/server/rbac.go): the lowest role of each action.
const ACTION_ROLES: Record<string, "team" | "admin"> = {
  "service.create": "team",
  "service.create.any_team": "admin",
  "service.update": "team",
  "service.update.team": "admin",
  "service.register": "admin",
  "service.delete": "admin",
  "service.address": "admin",
  "deploy.start": "team",
  "deploy.promote": "team",
  "deploy.rollback": "team",
  "environment.create": "team",
  "environment.extend": "team",
  "environment.destroy": "team",
  "operation.cancel": "team",
  "resource.plan": "team",
  "resource.apply": "team",
  "resource.apply.production": "admin",
  "cluster.read": "admin",
};
const GLOBAL_ACTIONS = ["service.create", "service.create.any_team", "service.register"];

// authAs answers GetStatus and TestPermissions for a caller as forge-api
// does. teamOf names the owner team of a service ("services/payments").
export function authAs(caller: Caller, teamOf: (service: string) => string = () => "") {
  const teams = [...(caller.teams ?? [])];
  return {
    getStatus: () => ({
      subject: "ana",
      permissions: caller.admin || teams.length ? ["services.read", "services.write"] : ["services.read"],
      admin: !!caller.admin,
      teams,
    }),
    testPermissions: (req: { service: string; actions: string[]; ownerTeam: string }) => {
      const team = req.service ? teamOf(req.service) : req.ownerTeam;
      const role = caller.admin ? "admin" : team && teams.includes(team) ? "team" : "reader";
      const actions = req.actions.length ? req.actions : req.service ? Object.keys(ACTION_ROLES).filter((a) => !GLOBAL_ACTIONS.includes(a)) : GLOBAL_ACTIONS;
      const allowed = actions.filter((a) => {
        if (a === "service.create" && !req.service && !req.ownerTeam) return !!caller.admin || teams.length > 0;
        return role === "admin" || (role === "team" && ACTION_ROLES[a] === "team");
      });
      return { allowed, role };
    },
  };
}
