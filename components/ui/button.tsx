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

// ExternalButton is a secondary button to a page outside the console, in a new
// tab; anything that is not a web address is left out.
export function ExternalButton({ href, children }: { href: string; children: string }) {
  if (!/^https?:\/\//i.test(href)) return null;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={`${base} ${sizes.md} ${kinds.secondary.replaceAll("enabled:", "")}`}>
      {children}
      <Icon name="external" size={13} />
    </a>
  );
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

const gear = (
  <>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </>
);
const external = (
  <>
    <path d="M14 4h6v6M20 4l-9 9" />
    <path d="M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
  </>
);
const marks = { plus, ship, gear, external };

// Icon is one of the small marks buttons carry: plus for "new", ship for "send it on", gear for settings.
export function Icon({ name, size = 15 }: { name: keyof typeof marks; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "gear" ? 1.8 : 2.1}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {marks[name]}
    </svg>
  );
}
