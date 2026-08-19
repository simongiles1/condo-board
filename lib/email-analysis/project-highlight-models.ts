/** Client-safe project-highlight model catalog (aliases of contact-highlight models). */

export {
  CONTACT_HIGHLIGHT_MODELS as PROJECT_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL as DEFAULT_PROJECT_HIGHLIGHT_MODEL,
  isContactHighlightModel as isProjectHighlightModel,
  resolveContactHighlightModel as resolveProjectHighlightModel,
  getContactHighlightModelMeta as getProjectHighlightModelMeta,
  getContactHighlightPassConfig as getProjectHighlightPassConfig,
  formatContactHighlightModelOptionLabel as formatProjectHighlightModelOptionLabel,
  contactHighlightModelProvider as projectHighlightModelProvider,
  type ContactHighlightModelId as ProjectHighlightModelId,
  type ContactHighlightPass as ProjectHighlightPass,
  type ContactHighlightPassConfig as ProjectHighlightPassConfig,
  type ContactHighlightChunkingConfig as ProjectHighlightChunkingConfig,
} from "@/lib/email-analysis/contact-highlight-models";
