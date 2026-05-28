"use client";

import TaskItem from "@tiptap/extension-task-item";
import TaskList from "@tiptap/extension-task-list";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { useEffect, useRef } from "react";

import {
  markdownToTodosEditorHtml,
  todosEditorHtmlToMarkdown,
} from "@/lib/markdown/todos-editor";

type Props = {
  /** Canonical markdown snapshot used whenever the editor reloads. */
  seedMarkdown: string;
  /** Bump this after persisted saves so TipTap resets from authoritative text. */
  reloadVersion: number;
  onMarkdownChange(markdown: string): void;
};

/** TipTap rich text for grouped todo checklists, persisted as Markdown. */
export function TodosEditor({
  seedMarkdown,
  reloadVersion,
  onMarkdownChange,
}: Props) {
  const seedRef = useRef(seedMarkdown);
  seedRef.current = seedMarkdown;

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [3] },
        bulletList: false,
        orderedList: false,
        blockquote: false,
        codeBlock: false,
        horizontalRule: false,
      }),
      TaskList,
      TaskItem.configure({
        nested: false,
      }),
    ],
    autofocus: false,
    immediatelyRender: false,
    editorProps: {
      attributes: {
        class: "todos-editor-body",
      },
    },
    onUpdate({ editor: instance }) {
      onMarkdownChange(todosEditorHtmlToMarkdown(instance.getHTML()));
    },
  });

  useEffect(() => {
    if (!editor) return;
    editor.commands.setContent(
      markdownToTodosEditorHtml(seedRef.current),
      false,
    );
  }, [editor, reloadVersion]);

  return (
    <div className="todos-editor-content rounded-xl border border-slate-200 bg-white shadow-inner ring-1 ring-teal-100">
      {!editor ? (
        <p className="p-6 text-sm text-slate-500">Loading editor…</p>
      ) : (
        <EditorContent editor={editor} />
      )}
    </div>
  );
}
