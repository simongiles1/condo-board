"use client";

import {
  validationScoreBadgeClasses,
  validationScoreLabel,
} from "@/lib/minutes/gold-standard-schema";

function CompareIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className="h-3.5 w-3.5"
      aria-hidden
    >
      <path
        fillRule="evenodd"
        d="M12.79 5.23a.75.75 0 0 1-.02 1.06L8.832 10l3.938 3.71a.75.75 0 1 1-1.04 1.08l-4.5-4.25a.75.75 0 0 1 0-1.08l4.5-4.25a.75.75 0 0 1 1.06.02Z"
        clipRule="evenodd"
      />
      <path
        fillRule="evenodd"
        d="M7.21 5.23a.75.75 0 0 0 .02 1.06L11.168 10l-3.938 3.71a.75.75 0 1 0 1.04 1.08l4.5-4.25a.75.75 0 0 0 0-1.08l-4.5-4.25a.75.75 0 0 0-1.06.02Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

type Props = {
  validationScore: number | null;
  onClick: () => void;
};

export function GoldStandardValidationBadge({
  validationScore,
  onClick,
}: Props) {
  const validated = validationScore !== null;

  const badgeCls = validated
    ? validationScoreBadgeClasses(validationScore)
    : "bg-slate-100 text-slate-600 ring-slate-200";

  const label = validated
    ? validationScoreLabel(validationScore)
    : "Compare";

  return (
    <button
      type="button"
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
      }}
      className={`inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-medium ring-1 transition hover:ring-2 hover:ring-teal-300/80 ${badgeCls}`}
      title={
        validated
          ? "View gold standard validation results"
          : "Compare against gold standard minutes"
      }
      aria-label={
        validated
          ? `Validation score ${label}. Open details.`
          : "Compare AI minutes against gold standard"
      }
    >
      {!validated ? <CompareIcon /> : null}
      {label}
    </button>
  );
}
