import { redirect } from "next/navigation";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function MeetingDetailRedirect(props: PageProps) {
  const { id } = await props.params;
  redirect(`/operations/meetings/${id}`);
}
