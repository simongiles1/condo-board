"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  children: string;
  className?: string;
};

const markdownComponents: Components = {
  img({ src, alt, ...rest }) {
    if (typeof src !== "string" || !src.trim()) return null;
    return <img src={src} alt={alt ?? ""} {...rest} />;
  },
};

export function MarkdownPreview({ children, className }: Props) {
  return (
    <div
      className={`prose prose-sm max-w-none prose-headings:text-slate-900 prose-p:text-slate-800 prose-li:text-slate-900 ${className ?? ""}`}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {children}
      </Markdown>
    </div>
  );
}
