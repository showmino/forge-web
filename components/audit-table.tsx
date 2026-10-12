import { NameLink } from "@/components/ui/button";
import { TableFrame, td, th, tr } from "@/components/ui/layout";
import { StatusBadge } from "@/components/ui/status";
import type { AuditEvent } from "@/gen/forge/v1/audit_pb";
import { serviceId } from "@/lib/api";
import { actorText, exact, when } from "@/lib/format";
import { auditStatus } from "@/lib/status";

const mono = "font-mono text-[12.5px]";

// AuditTable lists audit events, newest first as the API returns them. A
// failed or refused action shows its reason under the result.
export function AuditTable({ events }: { events: AuditEvent[] }) {
  return (
    <TableFrame label="Audit events">
      <thead>
        <tr>
          <th className={th}>Time</th>
          <th className={th}>Who</th>
          <th className={th}>Action</th>
          <th className={th}>Service</th>
          <th className={th}>Target</th>
          <th className={th}>Result</th>
        </tr>
      </thead>
      <tbody>
        {events.map((e) => {
          const status = auditStatus(e.result?.code);
          return (
            <tr key={e.name} className={tr}>
              <td className={`${td} text-fg-3`} title={exact(e.time)}>
                {when(e.time)}
              </td>
              <td className={`${td} ${mono}`}>{actorText(e)}</td>
              <td className={`${td} ${mono}`}>
                <b className="font-medium text-ember-ink">{e.action}</b>
              </td>
              <td className={td}>{e.service ? <NameLink href={`/services/${serviceId(e.service)}`}>{serviceId(e.service)}</NameLink> : "–"}</td>
              <td className={`${td} ${mono}`}>{e.target || "–"}</td>
              <td className={td}>
                <StatusBadge status={status} title={e.result?.code} />
                {status.tone !== "success" && e.result?.message ? (
                  <div className="mt-0.5 max-w-[280px] whitespace-normal text-[12px] text-fg-3">{e.result.message}</div>
                ) : null}
              </td>
            </tr>
          );
        })}
      </tbody>
    </TableFrame>
  );
}
