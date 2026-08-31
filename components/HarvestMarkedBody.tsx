"use client";

import { type ReactNode } from "react";

import { HarvestTypeIcon } from "@/components/HarvestTypeIcon";
import {
  HarvestHoverMark,
  HarvestMarkDataProvider,
  type HarvestMarkTooltipData,
} from "@/components/HarvestMarkTooltip";
import {
  HARVEST_GROUP_MARK_CLASS,
  HARVEST_UNRESOLVED_MARK_CLASS,
  harvestIconFor,
  primaryHarvestGroup,
} from "@/lib/email-analysis/harvest-highlight-theme";
import type { HarvestMarkNode } from "@/lib/email-analysis/harvest-highlight-spans";

function nodeIsFocused(node: HarvestMarkNode): boolean {
  return node.layers.some((layer) => layer.focus);
}

function MarkIcons({ node }: { node: HarvestMarkNode }) {
  const seen = new Set<string>();
  const icons = [];
  for (const layer of node.layers) {
    const icon = harvestIconFor(layer.group, layer.type);
    const key = `${layer.group}:${icon}`;
    if (seen.has(key)) continue;
    seen.add(key);
    icons.push(
      <HarvestTypeIcon
        key={key}
        icon={icon}
        className="mr-0.5 inline-block h-3 w-3 shrink-0 align-text-bottom"
      />,
    );
  }
  return icons;
}

function HarvestMark({
  text,
  node,
}: {
  text: string;
  node: HarvestMarkNode;
}) {
  const group = primaryHarvestGroup(node.layers.map((layer) => layer.group));
  const unresolved = node.layers.some((layer) => layer.unresolved);
  const groupClassName =
    unresolved && (group === "organization" || group === "contact")
      ? HARVEST_UNRESOLVED_MARK_CLASS[group]
      : HARVEST_GROUP_MARK_CLASS[group];

  return (
    <HarvestHoverMark
      text={text}
      node={node}
      groupClassName={groupClassName}
      focused={nodeIsFocused(node)}
    >
      <MarkIcons node={node} />
      {renderHarvestRange(text, node.start, node.end, node.children)}
    </HarvestHoverMark>
  );
}

export function renderHarvestRange(
  text: string,
  from: number,
  to: number,
  nodes: HarvestMarkNode[],
): ReactNode[] {
  const parts: ReactNode[] = [];
  let cursor = from;
  nodes.forEach((node, index) => {
    if (node.start > cursor) {
      parts.push(text.slice(cursor, node.start));
    }
    parts.push(
      <HarvestMark key={`${node.start}:${node.end}:${index}`} text={text} node={node} />,
    );
    cursor = node.end;
  });
  if (cursor < to) {
    parts.push(text.slice(cursor, to));
  }
  return parts;
}

export function HarvestMarkedInline({
  text,
  nodes,
  empty,
  className,
  contactCards = [],
  orgCards = [],
  projectCards = [],
  events = [],
  todos = [],
  reloadMentions,
}: {
  text: string;
  nodes: HarvestMarkNode[];
  empty?: ReactNode;
  className?: string;
  contactCards?: HarvestMarkTooltipData["contactCards"];
  orgCards?: HarvestMarkTooltipData["orgCards"];
  projectCards?: HarvestMarkTooltipData["projectCards"];
  events?: HarvestMarkTooltipData["events"];
  todos?: HarvestMarkTooltipData["todos"];
  reloadMentions?: () => void;
}): ReactNode {
  if (!text.trim()) {
    return empty ? <span className={className}>{empty}</span> : null;
  }

  return (
    <HarvestMarkDataProvider
      value={{
        text,
        contactCards,
        orgCards,
        projectCards,
        events,
        todos,
        reloadMentions,
      }}
    >
      <span className={className}>
        {renderHarvestRange(text, 0, text.length, nodes)}
      </span>
    </HarvestMarkDataProvider>
  );
}

export function HarvestMarkedBody({
  text,
  nodes,
  contactCards = [],
  orgCards = [],
  projectCards = [],
  events = [],
  todos = [],
  reloadMentions,
}: {
  text: string;
  nodes: HarvestMarkNode[];
  contactCards?: HarvestMarkTooltipData["contactCards"];
  orgCards?: HarvestMarkTooltipData["orgCards"];
  projectCards?: HarvestMarkTooltipData["projectCards"];
  events?: HarvestMarkTooltipData["events"];
  todos?: HarvestMarkTooltipData["todos"];
  reloadMentions?: () => void;
}): ReactNode {
  if (!text.trim()) {
    return <p className="text-sm text-slate-500">(No plain-text body)</p>;
  }

  return (
    <HarvestMarkDataProvider
      value={{
        text,
        contactCards,
        orgCards,
        projectCards,
        events,
        todos,
        reloadMentions,
      }}
    >
      <div className="prose prose-sm max-w-none whitespace-pre-wrap">
        {renderHarvestRange(text, 0, text.length, nodes)}
      </div>
    </HarvestMarkDataProvider>
  );
}
