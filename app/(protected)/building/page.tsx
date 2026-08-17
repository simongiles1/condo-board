import { redirect } from "next/navigation";

export default function BuildingIndexRedirect() {
  redirect("/building/overview");
}
