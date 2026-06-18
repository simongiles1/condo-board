import { redirect } from "next/navigation";
import { Suspense } from "react";

import { LoginForm } from "@/components/LoginForm";
import { getSessionUser, isAuthEnabled } from "@/lib/auth/session";

export default async function LoginPage() {
  if (isAuthEnabled()) {
    const user = await getSessionUser();
    if (user) {
      redirect("/");
    }
  }

  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading…
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
