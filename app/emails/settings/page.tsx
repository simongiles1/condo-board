import { redirect } from "next/navigation";

export default async function EmailSettingsRedirectPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; connected?: string }>;
}) {
  const params = await searchParams;
  const url = new URL("/settings", "http://localhost");

  if (params.error) {
    url.searchParams.set("error", params.error);
  }
  if (params.connected) {
    url.searchParams.set("connected", params.connected);
  }

  const target = `${url.pathname}${url.search}`;
  redirect(target);
}
