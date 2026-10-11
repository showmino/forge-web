import { TextLink } from "@/components/ui/button";
import { TableFrame, td, th, tr } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import { serviceId } from "@/lib/api";
import { exact, when } from "@/lib/format";
import { auditStatus } from "@/lib/status";

// actorText names who did it: a person by email, a CI run by its repository.
export function actorText(e: AuditEvent): string {
  const a = e.actor;
  if (!a) return "–";
  return a.email || a.repository || a.subject || a.kind || "–";
}

// AuditTable lists audit events, newest first as the API returns them.
export function AuditTable({ events, showService = true }: { events: AuditEvent[]; showService?: boolean }) {
  return (
    <TableFrame label="Audit events">
      <thead>
        <tr>
          <th className={th}>When</th>
          <th className={th}>Action</th>
          <th className={th}>Who</th>
          {showService ? <th className={th}>Service</th> : null}
          <th className={th}>Target</th>
          <th className={th}>Result</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => (
          <tr key={e.name} className={tr}>
            <td className={`${td} text-ink-muted`} title={exact(e.time)}>
              {when(e.time)}
            </td>
            <td className={`${td} type-code`}>{e.action}</td>
            <td className={td}>{actorText(e)}</td>
            {showService ? (
              <td className={td}>
                {e.service ? (
                  <TextLink href={`/services/${serviceId(e.service)}`} className="type-code">
                    {serviceId(e.service)}
                  </TextLink>
                ) : (
                  "–"
                )}
              </td>
            ) : null}
            <td className={`${td} type-code`}>{e.target || "–"}</td>
            <td className={td}>
              <StatusBadge status={auditStatus(e.result?.code)} title={e.result?.message || e.result?.code} />
            </td>
          </tr>
        ))}
      </tbody>
    </TableFrame>
  );
}
