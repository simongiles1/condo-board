"use client";

import {
  forwardRef,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

type AllowlistEntry = {
  id: string;
  email: string;
  displayName: string | null;
};

type Props = {
  value: string[];
  onChange: (value: string[]) => void;
};

export type EmailFromMultiSelectHandle = {
  commitPending: () => string[];
};

function normalizeEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  if (!email || !email.includes("@") || /\s/.test(email)) return null;
  return email;
}

export const EmailFromMultiSelect = forwardRef<EmailFromMultiSelectHandle, Props>(
  function EmailFromMultiSelect({ value, onChange }, ref) {
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);

  const [allowlist, setAllowlist] = useState<AllowlistEntry[]>([]);
  const [allowlistLoading, setAllowlistLoading] = useState(true);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [input, setInput] = useState("");

  useImperativeHandle(
    ref,
    () => ({
      commitPending() {
        const email = normalizeEmail(input);
        if (!email || value.includes(email)) {
          setInput("");
          return value;
        }
        const next = [...value, email];
        onChange(next);
        setInput("");
        return next;
      },
    }),
    [input, onChange, value],
  );

  useEffect(() => {
    let cancelled = false;

    async function loadAllowlist() {
      setAllowlistLoading(true);
      try {
        const response = await fetch("/api/email/allowlist");
        if (!response.ok) return;
        const data = (await response.json()) as AllowlistEntry[];
        if (!cancelled) setAllowlist(data);
      } catch {
        // Allow manual entry even if allowlist fails to load.
      } finally {
        if (!cancelled) setAllowlistLoading(false);
      }
    }

    void loadAllowlist();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!dropdownOpen) return;

    function onPointerDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setDropdownOpen(false);
      }
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setDropdownOpen(false);
      }
    }

    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dropdownOpen]);

  const selected = new Set(value);
  const availableAllowlist = allowlist.filter((entry) => !selected.has(entry.email));

  function addEmail(raw: string) {
    const email = normalizeEmail(raw);
    if (!email || selected.has(email)) return;
    onChange([...value, email]);
    setInput("");
  }

  function removeEmail(email: string) {
    onChange(value.filter((item) => item !== email));
  }

  function handleInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      addEmail(input);
      return;
    }

    if (event.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  return (
    <div ref={rootRef}>
      <div className="relative">
        <div className="rounded-md border border-slate-300 bg-white shadow-sm focus-within:border-teal-600 focus-within:ring-1 focus-within:ring-teal-600">
          {value.length > 0 ? (
            <ul className="flex flex-wrap gap-1.5 px-2 pt-2" aria-label="Selected senders">
              {value.map((email) => (
                <li key={email}>
                  <span className="inline-flex max-w-full items-center gap-1 rounded-md bg-slate-100 py-0.5 pl-2 pr-1 text-xs font-medium text-slate-800">
                    <span className="truncate">{email}</span>
                    <button
                      type="button"
                      onClick={() => removeEmail(email)}
                      aria-label={`Remove ${email}`}
                      className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                    >
                      <CloseIcon />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex items-center gap-1 px-2 py-1.5">
            <input
              id="email-filter-from"
              type="text"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={handleInputKeyDown}
              onBlur={() => {
                if (input.trim()) addEmail(input);
              }}
              placeholder={value.length > 0 ? "Add another email" : "name@example.com"}
              aria-autocomplete="list"
              aria-controls={dropdownOpen ? listboxId : undefined}
              className="min-w-0 flex-1 border-0 bg-transparent py-1 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
            />
            <button
              type="button"
              onClick={() => setDropdownOpen((open) => !open)}
              aria-label="Select from allowlist"
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
              disabled={allowlistLoading}
              title="Select from allowlist"
              className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <ChevronDownIcon className={dropdownOpen ? "rotate-180" : ""} />
            </button>
          </div>
        </div>

        {dropdownOpen ? (
          <ul
            id={listboxId}
            role="listbox"
            aria-label="Allowlist senders"
            className="absolute left-0 top-full z-30 mt-1 w-max min-w-full rounded-lg border border-slate-200 bg-white py-1 shadow-lg"
          >
            {allowlistLoading ? (
              <li className="whitespace-nowrap px-3 py-2 text-sm text-slate-500">
                Loading allowlist…
              </li>
            ) : availableAllowlist.length === 0 ? (
              <li className="whitespace-nowrap px-3 py-2 text-sm text-slate-500">
                {allowlist.length === 0
                  ? "No allowlist senders yet."
                  : "All allowlist senders are selected."}
              </li>
            ) : (
              availableAllowlist.map((entry) => (
                <li key={entry.id} role="presentation">
                  <button
                    type="button"
                    role="option"
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => {
                      addEmail(entry.email);
                      setDropdownOpen(false);
                    }}
                    className="block px-3 py-2 text-left text-sm hover:bg-slate-50"
                  >
                    <span className="block whitespace-nowrap font-medium text-slate-900">
                      {entry.email}
                    </span>
                    {entry.displayName ? (
                      <span className="block whitespace-nowrap text-xs text-slate-500">
                        {entry.displayName}
                      </span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>
        ) : null}
      </div>

      <p className="mt-1 text-xs text-slate-500">
        Pick from the allowlist or type any email and press Enter.
      </p>
    </div>
  );
});

function CloseIcon() {
  return (
    <svg
      aria-hidden
      className="h-3 w-3"
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`h-4 w-4 transition ${className ?? ""}`}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth={2}
    >
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}
