"use client";

import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { marked } from "marked";
import TurndownService from "turndown";
import { useEffect, useRef } from "react";

import { enhanceMinutesMarkdown } from "@/lib/markdown/enhance-minutes";

marked.setOptions({
  breaks: true,
  gfm: true,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  bulletListMarker: "-",
});

type Props = {
  /** Canonical markdown snapshot used whenever the editor reloads. */
  seedMarkdown: string;
  /** Bump this after persisted saves so TipTap resets from authoritative text. */
  reloadVersion: number;
  onMarkdownChange(markdown: string): void;
};

function markdownToEditorHtml(markdown: string): string {
  return marked.parse(enhanceMinutesMarkdown(markdown)) as string;
}

/** TipTap rich text persisted as Markdown via Turndown. */
export function MinutesEditor({
  seedMarkdown,
  reloadVersion,
  onMarkdownChange,
}: Props) {
  const seedRef = useRef(seedMarkdown);
  seedRef.current = seedMarkdown;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
    ],
    autofocus: "end",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "minutes-editor-body",
      },
    },
    onUpdate({ editor: instance }) {
      onMarkdownChange(turndown.turndown(instance.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(markdownToEditorHtml(seedRef.current), false);
  }, [editor, reloadVersion]);

  return (
    <div className="minutes-editor-content rounded-xl border border-slate-200 bg-white shadow-inner ring-1 ring-teal-100">
      {!editor ? (
        <p className="p-6 text-sm text-slate-500">Loading editor…</p>
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
