import { requireAuthRedirect } from "@/lib/auth/require-auth-redirect";

export default async function ProtectedLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  await requireAuthRedirect();
  return children;
}
