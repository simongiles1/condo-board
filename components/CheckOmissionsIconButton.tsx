"use client";

type Props = {
  runCount: number;
  onClick: () => void;
  disabled?: boolean;
};

export function CheckOmissionsIconButton({
  runCount,
  onClick,
  disabled,
}: Props) {
  const label =
    runCount === 0
      ? "Check omissions"
      : `Check omissions (${runCount} run${runCount === 1 ? "" : "s"})`;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className="relative inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-60"
    >
      <svg
        aria-hidden
        className="h-4 w-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
      </svg>
      <span
        aria-hidden
        className={`absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold leading-none ${
          runCount > 0
            ? "bg-teal-600 text-white"
            : "bg-slate-200 text-slate-600"
        }`}
      >
        {runCount}
      </span>
    </button>
  );
}
