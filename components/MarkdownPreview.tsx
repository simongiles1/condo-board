"use client";

import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  children: string;
  className?: string;
};

export function MarkdownPreview({ children, className }: Props) {
  return (
    <div
      className={`prose prose-sm max-w-none prose-headings:text-slate-900 prose-p:text-slate-800 prose-li:text-slate-900 ${className ?? ""}`}
    >
      <Markdown remarkPlugins={[remarkGfm]}>{children}</Markdown>
    </div>
  );
}
