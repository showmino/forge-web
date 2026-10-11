import { AppShell } from "@/components/app-shell";

// Every page in this group is behind the login.
export default function AppLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <AppShell>{children}</AppShell>;
}
