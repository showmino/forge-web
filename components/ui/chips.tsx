// FilterChips is a row of toggles that narrow a list, each with its count.
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string; count: number }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-full border px-[11px] py-1 text-[13px] ${
            value === o.value ? "border-fg bg-fg text-bg" : "border-line bg-surface text-fg-2 hover:border-fg-3 hover:text-fg"
          }`}
        >
          {o.label} <span className="font-mono text-[11.5px] opacity-80">{o.count}</span>
        </button>
      ))}
    </div>
  );
}
