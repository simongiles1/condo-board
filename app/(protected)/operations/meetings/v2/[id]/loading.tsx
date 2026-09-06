export default function MeetingV2WorkspaceLoading() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4" aria-busy="true">
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <div className="h-4 w-36 animate-pulse rounded bg-slate-100" />
          <div className="h-5 w-40 animate-pulse rounded-full bg-slate-100" />
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="rounded-t-2xl bg-gradient-to-r from-slate-950 via-slate-900 to-slate-800 px-4 py-4">
            <div className="h-7 w-56 animate-pulse rounded bg-white/10" />
            <div className="mt-2 h-4 w-32 animate-pulse rounded bg-white/10" />
            <div className="mt-4 h-24 animate-pulse rounded-xl bg-white/10" />
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="h-5 w-32 rounded bg-slate-100" />
            <div className="mt-4 grid gap-4 md:grid-cols-3">
              <div className="h-28 rounded-2xl bg-slate-100" />
              <div className="h-28 rounded-2xl bg-slate-100" />
              <div className="h-28 rounded-2xl bg-slate-100" />
            </div>
          </div>
          <div className="rounded-[2rem] border border-slate-200 bg-white p-6 shadow-sm">
            <div className="h-5 w-40 rounded bg-slate-100" />
            <div className="mt-4 space-y-3">
              <div className="h-24 rounded-2xl bg-slate-100" />
              <div className="h-24 rounded-2xl bg-slate-100" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
