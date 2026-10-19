import { marked } from "@/lib/docs";

// Marked shows text with the words a search found highlighted.
export function Marked({ text, terms }: { text: string; terms: string[] }) {
  return (
    <>
      {marked(text, terms).map((p, i) =>
        p.hit ? (
          <mark key={i} className="rounded-[3px] bg-ember-soft px-0.5 text-ember-ink">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}
