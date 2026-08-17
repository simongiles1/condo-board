import { redirect } from "next/navigation";

export default async function EmailsRedirect({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const url = new URL("/knowledge/emails", "http://localhost");
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  redirect(`${url.pathname}${url.search}`);
}
