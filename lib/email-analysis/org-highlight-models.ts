/** Client-safe org-highlight model catalog (aliases of contact-highlight models). */

export {
  CONTACT_HIGHLIGHT_MODELS as ORG_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL as DEFAULT_ORG_HIGHLIGHT_MODEL,
  isContactHighlightModel as isOrgHighlightModel,
  resolveContactHighlightModel as resolveOrgHighlightModel,
  getContactHighlightModelMeta as getOrgHighlightModelMeta,
  getContactHighlightPassConfig as getOrgHighlightPassConfig,
  formatContactHighlightModelOptionLabel as formatOrgHighlightModelOptionLabel,
  contactHighlightModelProvider as orgHighlightModelProvider,
  type ContactHighlightModelId as OrgHighlightModelId,
  type ContactHighlightPass as OrgHighlightPass,
  type ContactHighlightPassConfig as OrgHighlightPassConfig,
  type ContactHighlightChunkingConfig as OrgHighlightChunkingConfig,
} from "@/lib/email-analysis/contact-highlight-models";
