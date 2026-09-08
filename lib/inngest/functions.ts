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
          await updateMeetingV2Status(meetingId, "ingesting", "Loading legacy meeting sources", 5, null);
          await ingestMeetingV2Sources(meetingId);
          await updateMeetingV2Status(meetingId, "ingested", "Source ingestion complete", 20, null);
        });
      } else {
        await step.run("skip-ingest-meeting-v2-sources", async () => {
          await updateMeetingV2Status(meetingId, "ingested", "Source ingestion already complete", 20, null);
        });
      }

      if (!extractComplete) {
        await step.run("extract-meeting-v2-agenda", async () => {
          await updateMeetingV2Status(meetingId, "extracting", "Extracting agenda items", 25, null);
          await extractMeetingV2Agenda(meetingId);
          const extractionQuality = await assessMeetingV2Extraction(meetingId);
          if (extractionQuality.likelyIncomplete) {
            await updateMeetingV2Status(
              meetingId,
              "extracting",
              "Agenda extraction looks incomplete",
              30,
              extractionQuality.note,
            );
            return;
          }
          await updateMeetingV2Status(meetingId, "extracted", "Agenda extraction complete", 40, null);
        });
      } else {
        await step.run("skip-extract-meeting-v2-agenda", async () => {
          await updateMeetingV2Status(meetingId, "extracted", "Agenda extraction already complete", 40, null);
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
          await updateMeetingV2Status(
            meetingId,
            "extracted",
            "Awaiting agenda review & approval",
            40,
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
          await updateMeetingV2Status(meetingId, "gathering_evidence", "Assembling evidence context", 40, null);
          await retrieveAgendaItemEvidence(meetingId);
          await updateMeetingV2Status(meetingId, "evidence_gathered", "Evidence gathering complete", 60, null);
        });
      } else {
        await step.run("skip-gather-meeting-v2-evidence", async () => {
          await updateMeetingV2Status(meetingId, "evidence_gathered", "Evidence already assembled", 60, null);
        });
      }

      if (!investigationsComplete || (evidenceComplete && investigationsComplete && validationsComplete)) {
        await step.run("investigate-meeting-v2-items", async () => {
          await updateMeetingV2Status(meetingId, "investigating", "Investigating agenda items", 60, null);
          await investigateAgendaItems(meetingId);
          await updateMeetingV2Status(meetingId, "investigated", "Agenda investigation complete", 80, null);
        });
      } else {
        await step.run("skip-investigate-meeting-v2-items", async () => {
          await updateMeetingV2Status(meetingId, "investigated", "Agenda investigation already complete", 80, null);
        });
      }

      if (!validationsComplete || (evidenceComplete && investigationsComplete && validationsComplete)) {
        await step.run("prepare-meeting-v2-validation", async () => {
          await updateMeetingV2Status(meetingId, "validating", "Checking draft readiness", 80, null);
          await clearMeetingV2ValidationUsage(meetingId);
        });

        const pendingValidationItemIds = await step.run("list-pending-validation-items", async () => {
          return listPendingValidationAgendaItemIds(meetingId);
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
      } else {
        await step.run("skip-validate-meeting-v2-items", async () => {
          await updateMeetingV2Status(meetingId, "validating", "Validation already complete", 95, null);
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
