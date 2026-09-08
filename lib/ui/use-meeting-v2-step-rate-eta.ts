"use client";

import { useEffect, useRef, useState } from "react";

import {
  appendStepRateSample,
  estimateMeetingV2StepRateEta,
  parseMeetingV2StepProgress,
  type StepRateEstimate,
  type StepRateSample,
} from "@/lib/meeting-v2/pipeline-step-rate";

export function useMeetingV2StepRateEta(options: {
  active: boolean;
  currentStep: string;
  progressPercent: number;
}): StepRateEstimate | null {
  const { active, currentStep, progressPercent } = options;
  const samplesRef = useRef<StepRateSample[]>([]);
  const [estimate, setEstimate] = useState<StepRateEstimate | null>(null);

  useEffect(() => {
    if (!active) {
      samplesRef.current = [];
      setEstimate(null);
      return;
    }

    const parsed = parseMeetingV2StepProgress(currentStep);
    const stepKey = parsed?.stepKey ?? `percent-${Math.floor(progressPercent / 5) * 5}`;
    const sample: StepRateSample = {
      atMs: Date.now(),
      current: parsed?.current ?? Math.round(progressPercent),
      total: parsed?.total ?? 100,
      progressPercent,
      stepKey,
      unit: parsed?.unit ?? "percent",
    };

    if (samplesRef.current[0]?.stepKey !== stepKey) {
      samplesRef.current = [sample];
      setEstimate(null);
      return;
    }

    samplesRef.current = appendStepRateSample(samplesRef.current, sample);
    setEstimate(estimateMeetingV2StepRateEta(samplesRef.current));
  }, [active, currentStep, progressPercent]);

  return estimate;
}
