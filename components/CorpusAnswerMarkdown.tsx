"use client";

import {
  Children,
  cloneElement,
  isValidElement,
  type JSX,
  type ReactNode,
} from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

import { LinkedConceptText } from "@/components/LinkedConceptText";
import { MAX_ANSWER_CONTEXT_CHUNKS } from "@/lib/rag/answer-shared";
import type { CorpusSearchResult } from "@/lib/rag/search";

/** Model markers plus leaked backtick placeholders from an older renderer. */
const CITE_TOKEN_RE = /\[S(\d+)\]|@cite:(\d+)@/g;

function nodeText(node: ReactNode): string {
  return Children.toArray(node)
    .map((child) => {
      if (typeof child === "string" || typeof child === "number") {
        return String(child);
      }
      if (isValidElement<{ children?: ReactNode }>(child)) {
        return nodeText(child.props.children);
      }
      return "";
    })
    .join("");
}

function CiteChip({
  index,
  packed,
  onCite,
}: {
  index: number;
  packed: CorpusSearchResult[];
  onCite: (chunkId: string) => void;
}) {
  const label = `[S${index}]`;
  const source = packed[index - 1];
  if (!source) {
    return <span className="font-mono text-xs text-slate-700">{label}</span>;
  }
  return (
    <button
      type="button"
      onClick={() => onCite(source.id)}
      className="not-prose mx-0.5 inline rounded bg-teal-100 px-1 py-0 text-xs font-semibold text-teal-900 hover:bg-teal-200"
      title={source.metadata.filename || source.metadata.subject || "Source"}
    >
      {label}
    </button>
  );
}

function textWithCites(
  text: string,
  packed: CorpusSearchResult[],
  onCite: (chunkId: string) => void,
): ReactNode {
  const parts: ReactNode[] = [];
  let cursor = 0;
  CITE_TOKEN_RE.lastIndex = 0;
  for (const match of text.matchAll(CITE_TOKEN_RE)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      parts.push(
        <LinkedConceptText
          key={`t-${cursor}`}
          text={text.slice(cursor, start)}
        />,
      );
    }
    const index = Number(match[1] || match[2]);
    parts.push(
      <CiteChip
        key={`c-${start}-${index}`}
        index={index}
        packed={packed}
        onCite={onCite}
      />,
    );
    cursor = start + match[0].length;
  }
  if (cursor === 0) {
    return <LinkedConceptText text={text} />;
  }
  if (cursor < text.length) {
    parts.push(
      <LinkedConceptText key={`t-${cursor}`} text={text.slice(cursor)} />,
    );
  }
  return parts;
}

export function CorpusAnswerMarkdown({
  answer,
  results,
  onCite,
}: {
  answer: string;
  results: CorpusSearchResult[];
  onCite: (chunkId: string) => void;
}) {
  const packed = results.slice(0, MAX_ANSWER_CONTEXT_CHUNKS);

  function linkifyChildren(children: ReactNode): ReactNode {
    return Children.map(children, (child) => {
      if (typeof child === "string") {
        return textWithCites(child, packed, onCite);
      }
      if (!isValidElement<{ children?: ReactNode; className?: string }>(child)) {
        return child;
      }
      const type = child.type;
      if (type === "code" || type === "a") {
        const raw = nodeText(child.props.children).replace(/`/g, "").trim();
        const onlyCite = /^\[S(\d+)\]$|^@cite:(\d+)@$/.exec(raw);
        if (onlyCite) {
          return (
            <CiteChip
              index={Number(onlyCite[1] || onlyCite[2])}
              packed={packed}
              onCite={onCite}
            />
          );
        }
        return child;
      }
      if (type === "button") return child;
      if (child.props.children) {
        return cloneElement(child, {
          children: linkifyChildren(child.props.children),
        });
      }
      return child;
    });
  }

  function linkifyElement(Tag: keyof JSX.IntrinsicElements) {
    return function LinkedTag({
      children,
      node: _node,
      ...props
    }: {
      children?: ReactNode;
      node?: unknown;
    } & Record<string, unknown>) {
      const TagName = Tag;
      return <TagName {...props}>{linkifyChildren(children)}</TagName>;
    };
  }

  const components: Components = {
    p: linkifyElement("p"),
    li: linkifyElement("li"),
    h1: linkifyElement("h1"),
    h2: linkifyElement("h2"),
    h3: linkifyElement("h3"),
    strong: linkifyElement("strong"),
    em: linkifyElement("em"),
    td: linkifyElement("td"),
    th: linkifyElement("th"),
    code({ className, children, ...props }) {
      const raw = nodeText(children).replace(/`/g, "").trim();
      const onlyCite = /^\[S(\d+)\]$|^@cite:(\d+)@$/.exec(raw);
      if (onlyCite) {
        return (
          <CiteChip
            index={Number(onlyCite[1] || onlyCite[2])}
            packed={packed}
            onCite={onCite}
          />
        );
      }
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    },
  };

  return (
    <div className="prose prose-sm max-w-none prose-headings:mb-2 prose-headings:mt-3 prose-headings:text-slate-900 prose-p:my-2 prose-p:text-slate-800 prose-li:my-0.5 prose-li:text-slate-800 prose-ul:my-2">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {answer}
      </Markdown>
    </div>
  );
}
