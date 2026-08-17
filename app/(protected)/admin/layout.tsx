import { AdminWorkspaceBanner } from "@/components/AdminWorkspaceBanner";

export default function AdminLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <AdminWorkspaceBanner />
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{children}</div>
    </div>
  );
}
