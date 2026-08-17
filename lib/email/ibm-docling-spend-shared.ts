/**
 * IBM watsonx Docling trial coverage math (no DB).
 */

import { IBM_DOCLING_TRIAL_PAGES } from "@/lib/email/docling-provider";

export type IbmTrialAccountUsage = {
  archived: boolean;
  trialPages: number;
  pagesUsed: number;
};

export type IbmTrialCoverage = {
  trialPagesRemaining: number;
  extraAccountsNeeded: number;
  extraTrialPages: number;
  extraTrialUsd: number;
  shortfallPages: number;
};

export function ibmTrialCoverage(input: {
  remainingPages: number;
  accounts: IbmTrialAccountUsage[];
  usdPerPage: number;
  extraTrialPages?: number;
}): IbmTrialCoverage {
  const extraTrialPages = input.extraTrialPages ?? IBM_DOCLING_TRIAL_PAGES;
  let trialPagesRemaining = 0;
  for (const account of input.accounts) {
    if (account.archived) continue;
    trialPagesRemaining += Math.max(0, account.trialPages - account.pagesUsed);
  }
  const remainingPages = Math.max(0, input.remainingPages);
  const shortfallPages = Math.max(0, remainingPages - trialPagesRemaining);
  const extraAccountsNeeded =
    extraTrialPages <= 0 || shortfallPages === 0
      ? 0
      : Math.ceil(shortfallPages / extraTrialPages);
  return {
    trialPagesRemaining,
    extraAccountsNeeded,
    extraTrialPages,
    extraTrialUsd: extraAccountsNeeded * extraTrialPages * input.usdPerPage,
    shortfallPages,
  };
}
