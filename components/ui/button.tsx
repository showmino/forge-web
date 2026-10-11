import Link from "next/link";
import type { ButtonHTMLAttributes, ComponentProps } from "react";

// The design system's Button: a verb that says what happens. One primary
// button per view; danger only behind a confirmation.
type Kind = "primary" | "secondary" | "quiet" | "danger";

const base =
  "inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-md border px-3 type-body-strong disabled:cursor-not-allowed disabled:opacity-50";

const kinds: Record<Kind, string> = {
  primary: "border-accent bg-accent text-on-accent enabled:hover:brightness-110",
  secondary: "border-border-strong bg-surface text-ink enabled:hover:bg-surface-sunken",
  quiet: "border-transparent bg-transparent text-accent enabled:hover:bg-accent-soft",
  danger: "border-danger bg-danger text-on-danger enabled:hover:brightness-110",
};

export function Button({
  kind = "secondary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { kind?: Kind }) {
  return <button type="button" {...props} className={`${base} ${kinds[kind]} ${className}`} />;
}

// TextLink is a link inside the dashboard or out of it, in the accent colour.
export function TextLink({ className = "", ...props }: ComponentProps<typeof Link>) {
  return <Link {...props} className={`text-accent hover:underline ${className}`} />;
}
