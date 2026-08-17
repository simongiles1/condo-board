import { redirect } from "next/navigation";

export default function InsightsIndexRedirect() {
  redirect("/insights/queue");
}
