import { redirect } from "next/navigation";

export default async function EmailSettingsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const url = new URL("/admin/system/settings", "http://localhost");

  if (params.error) {
    url.searchParams.set("error", params.error);
  }
  if (params.connected) {
    url.searchParams.set("connected", params.connected);
  }

  redirect(`${url.pathname}${url.search}`);
}
