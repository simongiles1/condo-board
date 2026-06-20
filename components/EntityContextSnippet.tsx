"use client";

import { useState } from "react";

export function EntityContextSnippet({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const trimmed = text.trim();
  if (!trimmed) return null;

  const collapsible = trimmed.length > 120 || trimmed.includes("\n");

  return (
    <div className="mt-2 border-l-2 border-slate-200 pl-2">
      <p
        className={`whitespace-pre-wrap text-xs leading-relaxed text-slate-600 ${
          expanded || !collapsible ? "" : "line-clamp-2"
        }`}
      >
        {trimmed}
      </p>
      {collapsible ? (
        <button
          type="button"
          onClick={() => setExpanded((current) => !current)}
          className="mt-1 text-xs font-medium text-teal-700 hover:text-teal-800"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
}
