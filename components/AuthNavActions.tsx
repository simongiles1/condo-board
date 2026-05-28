"use client";

import { useRouter } from "next/navigation";

export function AuthNavActions({ email }: { email: string | null }) {
  const router = useRouter();

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  }

  if (!email) return null;

  return (
    <div className="flex items-center gap-3 text-sm text-slate-600">
      <span>{email}</span>
      <button
        type="button"
        onClick={() => void logout()}
        className="text-teal-700 hover:underline"
      >
        Sign out
      </button>
    </div>
  );
}
