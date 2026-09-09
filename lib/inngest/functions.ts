import { eq } from "drizzle-orm";

import { getDb } from "@/lib/db";
import { meetingsV2 } from "@/lib/db/schema";
import { inngest } from "./client";
import {
  classifyDeepSeekError,
  clearMeetingV2ValidationUsage,
  type MeetingV2Settings,
} from "@/lib/meeting-v2/extraction-diagnostics";
import {
  markMeetingV2PipelineSegmentStarted,
  recordMeetingV2PipelineSegmentDuration,
  resolveMeetingV2SegmentMilestonePercent,
  runTimedMeetingV2PipelineSegment,
} from "@/lib/meeting-v2/pipeline-segment-timing";
import {
  assessMeetingV2Extraction,
  deriveMeetingV2ComputedStatus,
  ensureMeetingV2Seed,
  extractMeetingV2Agenda,
  finalizeMeetingV2PipelineStatus,
  getMeetingV2Counts,
  ingestMeetingV2Sources,
  investigateAgendaItems,
  listPendingValidationAgendaItemIds,
  resetMeetingV2PostExtractData,
  retrieveAgendaItemEvidence,
  rerunAgendaItem,
  updateMeetingV2Status,
  validateAgendaItemInvestigations,
} from "@/lib/meeting-v2/service";

export const runMeetingV2Pipeline = inngest.createFunction(
  {
    id: "run-meeting-v2-pipeline",
    retries: 3,
    triggers: [{ event: "meeting-v2/pipeline.start" }],
  },
  async ({ event, step }) => {
    const { meetingId } = event.data;
    try {
      const pipelineSnapshot = await step.run("load-meeting-v2-stage-state", async () => {
        const db = getDb();
        const [meeting] = await db
          .select({ settings: meetingsV2.settings })
          .from(meetingsV2)
          .where(eq(meetingsV2.id, meetingId));
        const settings = (meeting?.settings as MeetingV2Settings) || {};
        const counts = await getMeetingV2Counts(meetingId);
        const computed = deriveMeetingV2ComputedStatus(counts, settings);
        const extractionQuality = await assessMeetingV2Extraction(meetingId);
        return { counts, computed, extractionQuality, settings };
      });
      const ingestComplete =
        pipelineSnapshot.counts.sourceArtifacts > 0 &&
        pipelineSnapshot.counts.transcriptSegments > 0 &&
        pipelineSnapshot.counts.documentPages > 0 &&
        pipelineSnapshot.counts.documentSections > 0 &&
        pipelineSnapshot.counts.documentChunks > 0;
      const extractComplete =
        pipelineSnapshot.counts.agendaItems > 0 && !pipelineSnapshot.extractionQuality.likelyIncomplete;
      const evidenceComplete =
        extractComplete &&
        pipelineSnapshot.counts.evidenceContexts >= pipelineSnapshot.counts.agendaItems;
      const investigationsComplete =
        extractComplete &&
        pipelineSnapshot.counts.investigations >= pipelineSnapshot.counts.agendaItems;
      const validationsComplete =
        investigationsComplete &&
        pipelineSnapshot.counts.validations >= pipelineSnapshot.counts.agendaItems;

      await step.run("seed-meeting-v2", async () => {
        await ensureMeetingV2Seed(meetingId);
      });

      if (!ingestComplete) {
        await step.run("ingest-meeting-v2-sources", async () => {
          const ingestStartPercent = await resolveMeetingV2SegmentMilestonePercent("ingest", "start");
          const ingestEndPercent = await resolveMeetingV2SegmentMilestonePercent("ingest", "end");
          await updateMeetingV2Status(
            meetingId,
            "ingesting",
            "Loading legacy meeting sources",
            ingestStartPercent,
            null,
          );
          await runTimedMeetingV2PipelineSegment(meetingId, "ingest", async () => {
            await ingestMeetingV2Sources(meetingId);
          });
          await updateMeetingV2Status(
            meetingId,
            "ingested",
            "Source ingestion complete",
            ingestEndPercent,
            null,
          );
        });
      } else {
        await step.run("skip-ingest-meeting-v2-sources", async () => {
          const ingestEndPercent = await resolveMeetingV2SegmentMilestonePercent("ingest", "end");
          await updateMeetingV2Status(
            meetingId,
            "ingested",
            "Source ingestion already complete",
            ingestEndPercent,
            null,
          );
        });
      }

      if (!extractComplete) {
        await step.run("extract-meeting-v2-agenda", async () => {
          const extractStartPercent = await resolveMeetingV2SegmentMilestonePercent("extract", "start");
          const extractEndPercent = await resolveMeetingV2SegmentMilestonePercent("extract", "end");
          await updateMeetingV2Status(
            meetingId,
            "extracting",
            "Extracting agenda items",
            extractStartPercent,
            null,
          );
          await runTimedMeetingV2PipelineSegment(meetingId, "extract", async () => {
            await extractMeetingV2Agenda(meetingId);
          });
          const extractionQuality = await assessMeetingV2Extraction(meetingId);
          if (extractionQuality.likelyIncomplete) {
            await updateMeetingV2Status(
              meetingId,
              "extracting",
              "Agenda extraction looks incomplete",
              extractStartPercent + Math.round((extractEndPercent - extractStartPercent) * 0.25),
              extractionQuality.note,
            );
            return;
          }
          await updateMeetingV2Status(
            meetingId,
            "extracted",
            "Agenda extraction complete",
            extractEndPercent,
            null,
          );
        });
      } else {
        await step.run("skip-extract-meeting-v2-agenda", async () => {
          const extractEndPercent = await resolveMeetingV2SegmentMilestonePercent("extract", "end");
          await updateMeetingV2Status(
            meetingId,
            "extracted",
            "Agenda extraction already complete",
            extractEndPercent,
            null,
          );
        });
      }

      const extractionQuality = await step.run("assess-meeting-v2-extraction", async () => {
        return assessMeetingV2Extraction(meetingId);
      });
      if (extractionQuality.likelyIncomplete) {
        return { success: false, meetingId, haltedAt: "extract", reason: extractionQuality.note };
      }

      const isAgendaApproved = await step.run("check-agenda-approval-state", async () => {
        const db = getDb();
        const [meeting] = await db
          .select({ settings: meetingsV2.settings })
          .from(meetingsV2)
          .where(eq(meetingsV2.id, meetingId));
        const settings = (meeting?.settings as MeetingV2Settings) || {};
        return Boolean(settings.agendaApproval?.approvedAt);
      });

      if (!isAgendaApproved) {
        await step.run("await-agenda-approval", async () => {
          const extractEndPercent = await resolveMeetingV2SegmentMilestonePercent("extract", "end");
          await updateMeetingV2Status(
            meetingId,
            "extracted",
            "Awaiting agenda review & approval",
            extractEndPercent,
            null,
          );
        });
        return {
          success: true,
          meetingId,
          haltedAt: "agenda_review",
          reason: "Agenda extracted. Awaiting human-in-the-loop review and approval before proceeding.",
        };
      }

      if (evidenceComplete && investigationsComplete && validationsComplete) {
        await step.run("reset-post-extract-data-for-rerun", async () => {
          await resetMeetingV2PostExtractData(meetingId);
        });
      }

      if (!evidenceComplete || (evidenceComplete && investigationsComplete && validationsComplete)) {
        await step.run("gather-meeting-v2-evidence", async () => {
          const evidenceStartPercent = await resolveMeetingV2SegmentMilestonePercent("evidence", "start");
          const evidenceEndPercent = await resolveMeetingV2SegmentMilestonePercent("evidence", "end");
          await updateMeetingV2Status(
            meetingId,
            "gathering_evidence",
            "Assembling evidence context",
            evidenceStartPercent,
            null,
          );
          await runTimedMeetingV2PipelineSegment(meetingId, "evidence", async () => {
            await retrieveAgendaItemEvidence(meetingId);
          });
          await updateMeetingV2Status(
            meetingId,
            "evidence_gathered",
            "Evidence gathering complete",
            evidenceEndPercent,
            null,
          );
        });
      } else {
        await step.run("skip-gather-meeting-v2-evidence", async () => {
          const evidenceEndPercent = await resolveMeetingV2SegmentMilestonePercent("evidence", "end");
          await updateMeetingV2Status(
            meetingId,
            "evidence_gathered",
            "Evidence already assembled",
            evidenceEndPercent,
            null,
          );
        });
      }

      if (!investigationsComplete || (evidenceComplete && investigationsComplete && validationsComplete)) {
        await step.run("investigate-meeting-v2-items", async () => {
          const investigateStartPercent = await resolveMeetingV2SegmentMilestonePercent("investigate", "start");
          const investigateEndPercent = await resolveMeetingV2SegmentMilestonePercent("investigate", "end");
          await updateMeetingV2Status(
            meetingId,
            "investigating",
            "Investigating agenda items",
            investigateStartPercent,
            null,
          );
          await runTimedMeetingV2PipelineSegment(meetingId, "investigate", async () => {
            await investigateAgendaItems(meetingId);
          });
          await updateMeetingV2Status(
            meetingId,
            "investigated",
            "Agenda investigation complete",
            investigateEndPercent,
            null,
          );
        });
      } else {
        await step.run("skip-investigate-meeting-v2-items", async () => {
          const investigateEndPercent = await resolveMeetingV2SegmentMilestonePercent("investigate", "end");
          await updateMeetingV2Status(
            meetingId,
            "investigated",
            "Agenda investigation already complete",
            investigateEndPercent,
            null,
          );
        });
      }

      if (!validationsComplete || (evidenceComplete && investigationsComplete && validationsComplete)) {
        await step.run("prepare-meeting-v2-validation", async () => {
          const validateStartPercent = await resolveMeetingV2SegmentMilestonePercent("validate", "start");
          await updateMeetingV2Status(
            meetingId,
            "validating",
            "Checking draft readiness",
            validateStartPercent,
            null,
          );
          await clearMeetingV2ValidationUsage(meetingId);
        });

        const pendingValidationItemIds = await step.run("list-pending-validation-items", async () => {
          return listPendingValidationAgendaItemIds(meetingId);
        });

        await step.run("start-meeting-v2-validation-timing", async () => {
          await markMeetingV2PipelineSegmentStarted(meetingId, "validate");
        });

        for (let index = 0; index < pendingValidationItemIds.length; index += 1) {
          const agendaItemId = pendingValidationItemIds[index];
          await step.run(`validate-meeting-v2-item-${index}`, async () => {
            console.info("[meetings:v2:validate] inngest item start", {
              meetingId,
              agendaItemId,
              index,
              total: pendingValidationItemIds.length,
            });
            await validateAgendaItemInvestigations(meetingId, agendaItemId);
          });
        }

        await step.run("record-meeting-v2-validation-timing", async () => {
          const db = getDb();
          const [meeting] = await db
            .select({ settings: meetingsV2.settings })
            .from(meetingsV2)
            .where(eq(meetingsV2.id, meetingId));
          const settings = (meeting?.settings as MeetingV2Settings) || {};
          const startedAt = settings.pipelineTiming?.segment === "validate"
            ? settings.pipelineTiming.startedAt
            : null;
          const startedMs = startedAt ? Date.parse(startedAt) : NaN;
          if (Number.isFinite(startedMs)) {
            await recordMeetingV2PipelineSegmentDuration(
              meetingId,
              "validate",
              Date.now() - startedMs,
            );
          }
        });
      } else {
        await step.run("skip-validate-meeting-v2-items", async () => {
          const validateEndPercent = await resolveMeetingV2SegmentMilestonePercent("validate", "end");
          await updateMeetingV2Status(
            meetingId,
            "validating",
            "Validation already complete",
            validateEndPercent,
            null,
          );
        });
      }
      await step.run("finalize-meeting-v2-status", async () => {
        await finalizeMeetingV2PipelineStatus(meetingId);
      });
      return { success: true, meetingId };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown V2 pipeline failure";
      const classified = classifyDeepSeekError(message);
      const friendlyMessage =
        classified.kind === "billing"
          ? `DeepSeek billing or quota error: ${message}`
          : classified.kind === "auth"
            ? `DeepSeek authentication error: ${message}`
            : message;
      await step.run("mark-meeting-failed", async () => {
        await updateMeetingV2Status(meetingId, "failed", "Pipeline failed", 100, friendlyMessage);
      });
      throw error;
    }
  },
);

export const reevaluateAgendaItem = inngest.createFunction(
  {
    id: "reevaluate-agenda-item",
    retries: 3,
    triggers: [{ event: "meeting-v2/item.reevaluate" }],
  },
  async ({ event, step }) => {
    const { meetingId, itemId } = event.data;
    await step.run("rerun-single-item", async () => {
      await rerunAgendaItem(meetingId, itemId);
    });
    return { success: true, meetingId, itemId };
  },
);
