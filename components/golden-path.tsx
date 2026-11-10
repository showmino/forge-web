"use client";

import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/components/providers";
import { ErrorNote, Loading } from "@/components/ui/layout";
import { Card, CardNote, Mark } from "@/components/ui/portal";
import type { GoldenCheck } from "@/gen/forge/v1/catalog_pb";

// GoldenPath is a service's golden-path card: how many of the checks that
// apply pass, as a ring, then each check and what to do about a missing one.
export function GoldenPath({ id }: { id: string }) {
  const api = useApi();
  const checks = useQuery({
    queryKey: ["checks", id],
    queryFn: () => api.catalog.listServiceChecks({ service: `services/${id}` }).then((r) => r.services[0]),
    retry: false,
  });
  return (
    <Card icon="shield" title="Golden path" more={{ href: "/services?status=offpath", label: "Off the path" }}>
      {checks.isPending ? (
        <Loading what="the checks" />
      ) : checks.error ? (
        <ErrorNote error={checks.error} />
      ) : !checks.data ? (
        <CardNote>No checks.</CardNote>
      ) : (
        <>
          <Ring passed={checks.data.passed} of={checks.data.applies} />
          <ul aria-label="Golden-path checks" className="m-0 mt-3 list-none p-0">
            {checks.data.checks.map((c) => (
              <CheckLine key={c.name} check={c} />
            ))}
          </ul>
        </>
      )}
    </Card>
  );
}

// Ring is how many checks pass, drawn as a part of a circle: green when all
// do, amber from three in five, red below.
function Ring({ passed, of }: { passed: number; of: number }) {
  const share = of ? passed / of : 1;
  const c = 2 * Math.PI * 15;
  const tone = share === 1 ? "stroke-ok-dot" : share >= 0.6 ? "stroke-warn-dot" : "stroke-bad-dot";
  return (
    <div className="flex items-center gap-3">
      <svg width="44" height="44" viewBox="0 0 36 36" aria-hidden="true">
        <circle cx="18" cy="18" r="15" fill="none" strokeWidth="4" className="stroke-surface-2" />
        <circle
          cx="18"
          cy="18"
          r="15"
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className={`origin-center -rotate-90 ${tone}`}
          strokeDasharray={`${(c * share).toFixed(1)} ${c.toFixed(1)}`}
        />
      </svg>
      <div>
        <div className="text-[13.5px] text-fg-2">Checks passing</div>
        <div className="font-display text-[20px] font-bold">
          {passed} of {of}
        </div>
      </div>
    </div>
  );
}

function CheckLine({ check: c }: { check: GoldenCheck }) {
  const mark = !c.applies ? "text-fg-3" : c.passed ? "bg-ok-bg text-ok-fg" : "bg-warn-bg text-warn-fg";
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-2.5 border-b border-line py-2 last:border-b-0">
      <span className={`mt-px grid size-[18px] place-items-center rounded-full ${mark}`} aria-hidden="true">
        {!c.applies ? "–" : c.passed ? <Mark name="check" size={11} /> : "!"}
      </span>
      <div className="min-w-0 text-[13.5px]">
        <div className={c.applies ? "font-medium" : "text-fg-3"}>
          {c.title}
          <span className="sr-only">: {!c.applies ? "does not apply" : c.passed ? "passes" : "missing"}</span>
        </div>
        <div className="text-[12.5px] break-words text-fg-3">{c.detail}</div>
      </div>
    </li>
  );
}
