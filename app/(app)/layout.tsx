import { AppShell } from '@/components/shared/app-shell';

// Layout for protected routes (post-login).
export default function AppLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
