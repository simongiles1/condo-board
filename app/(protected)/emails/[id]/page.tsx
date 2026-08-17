import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export default async function EmailDetailRedirect(props: PageProps) {
  const { id } = await props.params;
  const params = await props.searchParams;
  const url = new URL(`/knowledge/emails/${id}`, "http://localhost");
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) {
      for (const item of value) url.searchParams.append(key, item);
    } else if (value !== undefined) {
      url.searchParams.set(key, value);
    }
  }
  redirect(`${url.pathname}${url.search}`);
}
