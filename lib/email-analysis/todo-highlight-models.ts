/** Client-safe to-do harvest model catalog (aliases of contact-highlight models). */

export {
  CONTACT_HIGHLIGHT_MODELS as TODO_HIGHLIGHT_MODELS,
  DEFAULT_CONTACT_HIGHLIGHT_MODEL as DEFAULT_TODO_HIGHLIGHT_MODEL,
  isContactHighlightModel as isTodoHighlightModel,
  resolveContactHighlightModel as resolveTodoHighlightModel,
  getContactHighlightModelMeta as getTodoHighlightModelMeta,
  getContactHighlightPassConfig as getTodoHighlightPassConfig,
  formatContactHighlightModelOptionLabel as formatTodoHighlightModelOptionLabel,
  contactHighlightModelProvider as todoHighlightModelProvider,
  type ContactHighlightModelId as TodoHighlightModelId,
  type ContactHighlightPass as TodoHighlightPass,
  type ContactHighlightPassConfig as TodoHighlightPassConfig,
  type ContactHighlightChunkingConfig as TodoHighlightChunkingConfig,
} from "@/lib/email-analysis/contact-highlight-models";
