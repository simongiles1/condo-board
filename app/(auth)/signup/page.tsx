import { Suspense } from "react";

import { SignupForm } from "@/components/SignupForm";

export default function SignupPage() {
  return (
    <Suspense
      fallback={
        <div className="rounded-lg border border-slate-200 bg-white p-6 text-sm text-slate-600">
          Loading…
        </div>
      }
    >
      <SignupForm />
    </Suspense>
  );
}
