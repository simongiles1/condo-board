"use client";

import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

type Props = {
  children: string;
  className?: string;
  /** Called for `#pkg/…` links instead of navigating. */
  onPackagePage?: (href: string) => void;
};

const markdownComponents: Components = {
  img({ src, alt, ...rest }) {
    if (typeof src !== "string" || !src.trim()) return null;
    return <img src={src} alt={alt ?? ""} {...rest} />;
  },
};

/**
 * Renders markdown. Package-page links (`#pkg/13`) call `onPackagePage` when set.
 */
export function MarkdownPreview({ children, className, onPackagePage }: Props) {
  const components: Components = onPackagePage
    ? {
        ...markdownComponents,
        a({ href, children: linkChildren, ...rest }) {
          if (href?.startsWith("#pkg/")) {
            return (
              <button
                type="button"
                className="font-medium text-teal-800 underline"
                onClick={() => onPackagePage(href)}
              >
                {linkChildren}
              </button>
            );
          }
          return (
            <a href={href} {...rest}>
              {linkChildren}
            </a>
          );
        },
      }
    : markdownComponents;

  return (
    <div
      className={`prose prose-sm max-w-none prose-headings:text-slate-900 prose-p:text-slate-800 prose-li:text-slate-900 ${className ?? ""}`}
    >
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </Markdown>
    </div>
  );
}
