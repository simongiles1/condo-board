import {
  formatDateTime,
  formatDisplayDate,
  formatDisplayTime,
} from "@/lib/format/datetime";

type Props = {
  value: string;
  className?: string;
};

/** Full date/time on md+; date and time on separate lines on small screens. */
export function DateTimeDisplay({ value, className = "" }: Props) {
  return (
    <time dateTime={value} className={className}>
      <span className="hidden whitespace-nowrap md:inline">
        {formatDateTime(value)}
      </span>
      <span className="md:hidden">
        <span className="block">{formatDisplayDate(value)}</span>
        <span className="block">{formatDisplayTime(value)}</span>
      </span>
    </time>
  );
}
