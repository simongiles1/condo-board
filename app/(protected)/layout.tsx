import { AppShellWrapper } from "@/components/AppShellWrapper";
import { requireAuthRedirect } from "@/lib/auth/require-auth-redirect";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAuthRedirect();
  return <AppShellWrapper>{children}</AppShellWrapper>;
}
