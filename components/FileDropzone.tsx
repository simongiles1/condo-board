"use client";

import React, {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

type Props = {
  label: string;
  name: string;
  accept: string;
  hint?: string;
  required?: boolean;
  onFileChange?: (file: File | null) => void;
};

/** Native file input styled as dashed drop-area. */
export function FileDropzone({
  label,
  name,
  accept,
  hint,
  required = true,
  onFileChange,
}: Props) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);

  const onPick = useCallback(
    (e: ChangeEvent<HTMLInputElement>) => {
      const f = e.target.files?.[0] ?? null;
      setFileName(f?.name ?? null);
      onFileChange?.(f);
    },
    [onFileChange],
  );

  const openPicker = useCallback(() => {
    inputRef.current?.click();
  }, []);

  const onDropFiles = useCallback(
    (e: DragEvent) => {
      e.preventDefault();
      const f = e.dataTransfer.files?.[0];
      if (f && inputRef.current) {
        const dt = new DataTransfer();
        dt.items.add(f);
        inputRef.current.files = dt.files;
        setFileName(f.name);
        onFileChange?.(f);
      }
    },
    [onFileChange],
  );

  const preventDefaults = useCallback((e: DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  return (
    <div className="flex flex-col gap-2">
      <label htmlFor={inputId} className="text-sm font-medium text-slate-800">
        {label}
      </label>
      <div
        role="button"
        tabIndex={0}
        aria-label={`${label}. Drop files here or activate to browse.`}
        className="flex cursor-pointer flex-col rounded-lg border-2 border-dashed border-teal-200 bg-teal-50/40 px-4 py-6 text-center text-sm transition hover:border-teal-400 hover:bg-teal-50"
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openPicker();
          }
        }}
        onClick={openPicker}
        onDragEnter={preventDefaults}
        onDragOver={preventDefaults}
        onDrop={onDropFiles}
      >
        <span className="font-medium text-teal-900">Drop files here</span>
        <span className="mt-1 text-slate-600">or click to browse</span>
        <span className="mt-2 text-xs text-slate-500">
          {hint ?? accept.replace(/,/g, ", ")}
        </span>
        {fileName ? (
          <span className="mt-3 rounded bg-white px-2 py-1 font-mono text-xs text-slate-700 ring-1 ring-slate-200">
            Selected: {fileName}
          </span>
        ) : (
          <span className="mt-3 text-xs text-amber-800">
            No file chosen yet ({required ? "required" : "optional"})
          </span>
        )}
      </div>
      <input
        ref={inputRef}
        id={inputId}
        name={name}
        type="file"
        accept={accept}
        required={required}
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none fixed h-0 w-0 opacity-0"
        onChange={onPick}
      />
    </div>
  );
}
