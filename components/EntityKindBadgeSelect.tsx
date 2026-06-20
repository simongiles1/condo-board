"use client";

import { useEffect, useRef, useState } from "react";

import { entityTypeBadgeClass } from "@/lib/email/entity-dedup";
import type { EditableEntityKind } from "@/lib/entities/entity-review";

const OPTIONS: Array<{ value: EditableEntityKind; label: string }> = [
  { value: "contact", label: "Contact" },
  { value: "organization", label: "Organization" },
];

type Props = {
  value: EditableEntityKind;
  onChange: (kind: EditableEntityKind) => void;
  disabled?: boolean;
};

export function EntityKindBadgeSelect({ value, onChange, disabled = false }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const selected =
    OPTIONS.find((option) => option.value === value) ?? OPTIONS[0];
  const badgeType = value === "contact" ? "person" : "org";

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Entity type: ${selected.label}. Click to change.`}
        onClick={() => {
          if (!disabled) setOpen((current) => !current);
        }}
        className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ring-1 transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-60 ${entityTypeBadgeClass(badgeType)}`}
      >
        {selected.label}
        <span aria-hidden className="text-[9px] opacity-70">
          ▾
        </span>
      </button>

      {open ? (
        <ul
          role="listbox"
          aria-label="Entity type"
          className="absolute left-0 top-full z-20 mt-1 min-w-[10rem] overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
        >
          {OPTIONS.map((option) => {
            const isSelected = option.value === value;
            return (
              <li key={option.value} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onClick={() => {
                    onChange(option.value);
                    setOpen(false);
                  }}
                  className={`flex w-full items-center px-3 py-1.5 text-left text-xs font-medium ${
                    isSelected
                      ? "bg-slate-100 text-slate-900"
                      : "text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
