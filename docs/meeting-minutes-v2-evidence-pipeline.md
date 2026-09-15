# Meeting Minutes V2 evidence pipeline

The pipeline version is `2026-09-evidence-v4`. A successful draft requires current evidence, an investigation for every approved agenda item, and a completed passing validation for each investigation.

## Stage contracts

1. **Ingest and extract:** retain complete page text and process the full package. Resume missing pages without skipping holes. Preserve printed agenda codes, distinct items with matching titles, prior notes, chunk references, discrepancies, and transcript continuations across incremental responses. Invalid package extraction fails the stage.
2. **Finalize segmentation:** save the ranges after edge, gap, and lifecycle review as the canonical agenda evidence map. Both the transcript overlay and evidence assembly derive from this map, including topics accepted during agenda review.
3. **Resolve facts:** resolve material contractors, amounts, approvals, dates, and conditions before generating prose. Each candidate cites a source ID and a verifiable quotation. Keep package proposals, prior approvals, and current decisions separate. A package candidate cannot override conflicting meeting evidence, and a package proposal cannot establish a current decision. Unresolved selections block drafting.
4. **Investigate:** use the resolved facts and labeled direct, neighboring, and related evidence. Malformed output or API failure remains a failure. Recommended answers and revised notes remain model proposals; only submitted user clarifications become evidence. Do not invent motion participants or promote an unknown vote to carried.
5. **Validate and repair:** review the complete evidence and tool responses. Run one repair when needed and review the repaired investigation again. Persist the final review, including failures and requests for human review. A repair is never accepted without a fresh review.
6. **Assemble:** require current investigation and validation provenance, check source files again, and account for each substantive agenda item exactly once. Keep structural headings separate from substantive topics. Preserve prior drafts when creating a new version.
7. **Render:** assign sibling numbers and letters from the complete agenda, then filter restricted items into the addendum. Public `(b)` followed by `(d)` and restricted `(c)` is intentional. Apply the same rule to nested items and financial subsections in Markdown and PDF. Missing meeting times, vote results, and attendance evidence are not filled with template assumptions.

## Existing meetings and re-evaluation

Run the full pipeline for an existing meeting after this upgrade. The preflight checks source checksums and the pipeline version. Unknown or changed sources require re-ingestion; a rules change rebuilds derived data, chunks, and section boundaries from retained source pages when possible. The regenerated agenda requires approval before investigation continues.

Agenda edits and submitted clarifications make draft readiness false. An item re-evaluation replaces its result only after a successful investigation and then validates it. Failed or unresolved validation keeps generation blocked with an explanation. Earlier drafts remain available. Clarifications from changed source files are retained in settings history rather than silently reused.

The new fact-resolution calls and repair/review calls are included in the usage display. Reference coverage is reported only when curated expectations exist; ambiguous matches do not count as complete coverage.

## Verification

Run `npm run test:meeting-v2-pipeline` for the regression suite. It covers the conflicting August 12 bids, temporal scope, quotation checks, loss of late evidence, incremental extraction, validation and repair failures, stale drafts, missing or duplicate items, restricted numbering, and PDF output. The bid fixture is a synthetic reproduction of the reported issue; it is not a live replay of V12.

For visual PDF QA, set `MEETING_V2_PDF_QA_DIR` to a temporary directory before running `scripts/test-meeting-v2-pdf.tsx`. Normal test runs leave no PDF artifacts.

Implementation verification: 95 regression tests passed; a scoped TypeScript check passed across 60 V2 and related files; all three fixture PDF pages were visually inspected. The repository-wide TypeScript build still has unrelated existing errors. No live meeting was regenerated or deployed as part of this verification. A real August 12 replay remains the acceptance check for model behavior on the original evidence.
