"use client";

import { useState } from "react";

import { GenerateMeetingDialog } from "@/components/GenerateMeetingDialog";

export function MeetingsPageHeader() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Chronicle
          </p>
          <h1 className="text-2xl font-semibold text-slate-900">
            Meeting workspaces
          </h1>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="text-sm font-semibold text-teal-700 hover:text-teal-900"
        >
          + New upload
        </button>
      </div>
      <GenerateMeetingDialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
      />
    </>
  );
}
