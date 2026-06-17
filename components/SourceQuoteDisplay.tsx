import {
  formatSourceQuote,
  type FormattedSourceQuote,
} from "@/lib/email/format-source-quote";

function IcalQuote({ quote }: { quote: Extract<FormattedSourceQuote, { kind: "ical" }> }) {
  const isEvent = quote.variant === "event";

  return (
    <div className="mt-2 space-y-1.5 rounded-md border border-slate-200 bg-slate-50/80 px-3 py-2 text-xs text-slate-700">
      <p className="font-medium text-slate-800">
        From calendar invite
        {!isEvent ? (
          <span className="font-normal text-slate-500"> · {quote.roleLabel}</span>
        ) : null}
      </p>
      {isEvent ? (
        <p className="text-sm font-medium text-slate-900">{quote.roleLabel}</p>
      ) : null}
      {!isEvent && (quote.name || quote.email) ? (
        <p className="text-slate-900">
          {quote.name ?? "Unknown"}
          {quote.email ? (
            <span className="text-slate-600">
              {" "}
              ·{" "}
              <a
                href={`mailto:${quote.email}`}
                className="text-teal-700 hover:underline"
              >
                {quote.email}
              </a>
            </span>
          ) : null}
        </p>
      ) : null}
      {quote.details.length > 0 ? (
        <dl className="grid gap-x-3 gap-y-0.5 sm:grid-cols-[auto_1fr]">
          {quote.details.map((detail) => (
            <div key={detail.label} className="contents">
              <dt className="text-slate-500">{detail.label}</dt>
              <dd className="text-slate-800">{detail.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </div>
  );
}

export function SourceQuoteDisplay({ quote }: { quote: string }) {
  const formatted = formatSourceQuote(quote);

  if (formatted.kind === "ical") {
    return <IcalQuote quote={formatted} />;
  }

  return (
    <blockquote className="mt-2 border-l-2 border-slate-200 pl-3 text-xs italic text-slate-600">
      &ldquo;{formatted.text}&rdquo;
    </blockquote>
  );
}
