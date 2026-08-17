import { redirect } from "next/navigation";

export default function UsersRedirect() {
  redirect("/admin/system/users");
}
