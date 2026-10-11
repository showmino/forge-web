import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

// The Forge design language's buttons. Ember is for the one primary action of
// a view; danger only behind a confirmation.
type Kind = "primary" | "secondary" | "quiet" | "danger";
type Size = "md" | "sm";

const base =
  "inline-flex cursor-pointer items-center gap-[7px] whitespace-nowrap rounded-md border type-body-strong no-underline disabled:cursor-not-allowed disabled:opacity-50";

const sizes: Record<Size, string> = {
  md: "px-[13px] py-[7px]",
  sm: "px-[9px] py-1 text-[12.5px]",
};

const kinds: Record<Kind, string> = {
  primary:
    "border-ember bg-ember text-ember-on shadow-[inset_0_1px_0_oklch(1_0_0/0.18),0_1px_2px_oklch(0.4_0.12_40/0.3)] enabled:hover:brightness-95",
  secondary: "border-line-strong bg-surface text-fg enabled:hover:border-fg-3",
  quiet: "border-transparent bg-transparent text-fg-2 enabled:hover:bg-surface-2 enabled:hover:text-fg",
  danger: "border-bad-dot bg-bad-dot text-on-bad enabled:hover:brightness-95",
};

export function Button({
  kind = "secondary",
  size = "md",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: Kind; size?: Size }) {
  return <button type="button" {...props} className={`${base} ${sizes[size]} ${kinds[kind]} ${className}`} />;
}

// ButtonLink goes to another page but carries the weight of a button: for the
// one main action of a view when that action is a page of its own.
export function ButtonLink({
  kind = "secondary",
  size = "md",
  className = "",
  ...props
}: ComponentProps<typeof Link> & { kind?: Kind; size?: Size }) {
  return <Link {...props} className={`${base} ${sizes[size]} ${kinds[kind].replaceAll("enabled:", "")} ${className}`} />;
}

// TextLink is a link in running text or a list.
export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={`text-info-fg no-underline hover:underline ${className}`} />;
}

// NameLink is the name of a thing, set in mono exactly as typed in the terminal, leading to its page.
export function NameLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={`font-mono text-[13.5px] font-medium text-fg no-underline hover:underline ${className}`} />;
}

// Addr is an address outside the console: it opens in a new tab.
export function Addr({ href, className = "" }: { href: string; className?: string }) {
  // Anything that is not a web address is shown as text, never as something to click.
  if (!/^https?:\/\//i.test(href)) return <span className={`break-all font-mono text-[12.5px] ${className}`}>{href}</span>;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={`break-all font-mono text-[12.5px] text-info-fg no-underline hover:underline ${className}`}
    >
      {href.replace(/^https?:\/\//, "")}
    </a>
  );
}

const plus = <path d="M12 5v14M5 12h14" />;
const ship = (
  <>
    <path d="M4 12h11M11 6l6 6-6 6" />
    <path d="M20 4v16" />
  </>
);

// Icon is one of the two small marks buttons carry: plus for "new", ship for "send it on".
export function Icon({ name }: { name: "plus" | "ship" }) {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.1"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {name === "plus" ? plus : ship}
    </svg>
  );
}
