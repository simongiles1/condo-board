export type ParsedStepProgress = {
  current: number;
  total: number;
  unit: string;
  stepKey: string;
};

const STEP_PROGRESS_PATTERNS: Array<{
  regex: RegExp;
  unit: string;
  stepKey: (match: RegExpMatchArray) => string;
}> = [
  {
    regex: /Extracting (?:package|transcript) chunk (\d+)\/(\d+)/i,
    unit: "chunks",
    stepKey: (match) => `extract-chunk-${match[2]}`,
  },
  {
    regex: /Ingesting board package pages \((\d+)\/(\d+)\)/i,
    unit: "pages",
    stepKey: (match) => `ingest-pages-${match[2]}`,
  },
  {
    regex: /Extracting agenda items \((\d+)\/(\d+)\)/i,
    unit: "items",
    stepKey: (match) => `extract-items-${match[2]}`,
  },
  {
    regex: /Gathering evidence \((\d+)\/(\d+)\)/i,
    unit: "items",
    stepKey: (match) => `evidence-${match[2]}`,
  },
  {
    regex: /Investigating items \((\d+)\/(\d+)\)/i,
    unit: "items",
    stepKey: (match) => `investigate-${match[2]}`,
  },
  {
    regex: /Validating items \((\d+)\/(\d+)\)/i,
    unit: "items",
    stepKey: (match) => `validate-${match[2]}`,
  },
];

export function parseMeetingV2StepProgress(step: string): ParsedStepProgress | null {
  const trimmed = step.trim();
  if (!trimmed) return null;

  for (const pattern of STEP_PROGRESS_PATTERNS) {
    const match = trimmed.match(pattern.regex);
    if (!match) continue;

    const current = Number.parseInt(match[1], 10);
    const total = Number.parseInt(match[2], 10);
    if (!Number.isFinite(current) || !Number.isFinite(total) || total <= 0) {
      continue;
    }

    return {
      current,
      total,
      unit: pattern.unit,
      stepKey: pattern.stepKey(match),
    };
  }

  return null;
}

export type StepRateSample = {
  atMs: number;
  current: number;
  total: number;
  progressPercent: number;
  stepKey: string;
  unit: string;
};

export type StepRateEstimate = {
  rateLabel: string;
  etaLabel: string;
};

const MIN_SAMPLE_SPAN_MS = 4_000;
const MAX_SAMPLES = 24;

function formatRate(perMinute: number, unit: string): string {
  if (!Number.isFinite(perMinute) || perMinute <= 0) return "—";
  if (perMinute >= 10) {
    return `~${Math.round(perMinute)} ${unit}/min`;
  }
  return `~${perMinute.toFixed(1)} ${unit}/min`;
}

export function formatDurationShort(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `~${Math.max(1, Math.round(seconds))} sec`;
  if (seconds < 3600) return `~${Math.max(1, Math.round(seconds / 60))} min`;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.round((seconds % 3600) / 60);
  return minutes > 0 ? `~${hours}h ${minutes}m` : `~${hours}h`;
}

export function estimateMeetingV2StepRateEta(
  samples: StepRateSample[],
): StepRateEstimate | null {
  if (samples.length < 2) return null;

  const latest = samples[samples.length - 1];
  const earliest = samples.find(
    (sample) =>
      sample.stepKey === latest.stepKey &&
      latest.atMs - sample.atMs >= MIN_SAMPLE_SPAN_MS,
  );
  if (!earliest) return null;

  const elapsedSeconds = (latest.atMs - earliest.atMs) / 1000;
  if (elapsedSeconds <= 0) return null;

  const unitDelta = latest.current - earliest.current;
  if (unitDelta > 0 && latest.unit !== "percent") {
    const perSecond = unitDelta / elapsedSeconds;
    const perMinute = perSecond * 60;
    const remaining = Math.max(0, latest.total - latest.current);
    const etaSeconds = remaining / perSecond;

    return {
      rateLabel: formatRate(perMinute, latest.unit),
      etaLabel: formatDurationShort(etaSeconds),
    };
  }

  const percentDelta = latest.progressPercent - earliest.progressPercent;
  if (percentDelta <= 0) return null;

  const percentPerSecond = percentDelta / elapsedSeconds;
  const percentPerMinute = percentPerSecond * 60;
  const remainingPercent = Math.max(0, 100 - latest.progressPercent);
  const etaSeconds = remainingPercent / percentPerSecond;

  return {
    rateLabel: `~${percentPerMinute.toFixed(1)}%/min`,
    etaLabel: formatDurationShort(etaSeconds),
  };
}

export function appendStepRateSample(
  samples: StepRateSample[],
  sample: StepRateSample,
): StepRateSample[] {
  const last = samples[samples.length - 1];
  if (
    last &&
    last.stepKey === sample.stepKey &&
    last.current === sample.current &&
    last.progressPercent === sample.progressPercent
  ) {
    return samples;
  }

  const next = [...samples, sample];
  if (next.length > MAX_SAMPLES) {
    return next.slice(next.length - MAX_SAMPLES);
  }
  return next;
}
