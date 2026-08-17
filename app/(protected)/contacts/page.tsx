import { redirect } from "next/navigation";

/** Legacy path — registry lives under /knowledge/entities. */
export default function ContactsRedirectPage() {
  redirect("/knowledge/entities");
}
