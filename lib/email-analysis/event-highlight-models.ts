/** Client-safe event-harvest model catalog (aliases of contact-highlight models). */

export {
  CONTACT_HIGHLIGHT_MODELS as EVENT_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL as DEFAULT_EVENT_HIGHLIGHT_MODEL,
  isContactHighlightModel as isEventHighlightModel,
  resolveContactHighlightModel as resolveEventHighlightModel,
  getContactHighlightModelMeta as getEventHighlightModelMeta,
  getContactHighlightPassConfig as getEventHighlightPassConfig,
  formatContactHighlightModelOptionLabel as formatEventHighlightModelOptionLabel,
  contactHighlightModelProvider as eventHighlightModelProvider,
  type ContactHighlightModelId as EventHighlightModelId,
  type ContactHighlightPass as EventHighlightPass,
  type ContactHighlightPassConfig as EventHighlightPassConfig,
  type ContactHighlightChunkingConfig as EventHighlightChunkingConfig,
} from "@/lib/email-analysis/contact-highlight-models";
