import { level, type Meter as M } from "@/lib/cluster";

const bars = { ok: "bg-fg-3", warn: "bg-warn-dot", bad: "bg-bad-dot" };
const values = { ok: "text-fg-2", warn: "font-semibold text-warn-fg", bad: "font-semibold text-bad-fg" };

// Meter is a bar and a percentage: how much of something is in use. Without a
// figure it says only how much there is.
export function Meter({ label, meter, big = false }: { label: string; meter: M; big?: boolean }) {
  if (meter.pct === null) return <span className="text-[12.5px] text-fg-3">{meter.total}</span>;
  const l = level(meter.pct);
  return (
    <span className="flex flex-col gap-[3px]">
      <span className="flex items-center gap-2">
        <span
          role="img"
          aria-label={`${label} ${meter.pct}% used`}
          className={`block flex-1 overflow-hidden rounded-full bg-surface-2 shadow-[inset_0_0_0_1px_var(--line)] ${big ? "h-2" : "h-1.5"}`}
        >
          <i className={`block h-full rounded-full ${bars[l]}`} style={{ width: `${Math.min(meter.pct, 100)}%` }} />
        </span>
        <span className={`w-[38px] text-right text-[12.5px] tabular-nums ${values[l]}`}>{meter.pct}%</span>
      </span>
      <span className="font-mono text-[11.5px] text-fg-3">
        {meter.used} of {meter.total}
      </span>
    </span>
  );
}
