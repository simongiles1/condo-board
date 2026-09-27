"use client";

import { useState } from "react";

import { GenerateMeetingDialog } from "@/components/GenerateMeetingDialog";
import { GenerateMeetingV2Dialog } from "@/components/GenerateMeetingV2Dialog";

export function MeetingsPageHeader({ isV2 = false }: { isV2?: boolean }) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [upcomingOpen, setUpcomingOpen] = useState(false);

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
        <div className="flex flex-wrap items-center gap-4">
          {isV2 ? (
            <button
              type="button"
              onClick={() => setUpcomingOpen(true)}
              className="text-sm font-semibold text-teal-700 hover:text-teal-900"
            >
              + New meeting
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setDialogOpen(true)}
            className="text-sm font-semibold text-teal-700 hover:text-teal-900"
          >
            {isV2 ? "+ New V2 upload" : "+ New upload"}
          </button>
        </div>
      </div>
      {isV2 ? (
        <>
          <GenerateMeetingV2Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
          />
          <GenerateMeetingV2Dialog
            mode="upcoming"
            open={upcomingOpen}
            onClose={() => setUpcomingOpen(false)}
          />
        </>
      ) : (
        <GenerateMeetingDialog
          open={dialogOpen}
          onClose={() => setDialogOpen(false)}
        />
      )}
    </>
  );
}
