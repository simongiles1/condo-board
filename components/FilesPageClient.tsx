"use client";

import { useState } from "react";

import { FileCategorySection } from "@/components/FileCategorySection";
import { FilesTabStrip } from "@/components/FilesTabStrip";
import {
  FILE_CATEGORY_ORDER,
  type CategorizedFiles,
  type FileCategory,
} from "@/lib/email/file-categories";

type Props = {
  categorizedFiles: CategorizedFiles;
};

export function FilesPageClient({ categorizedFiles }: Props) {
  const [activeTab, setActiveTab] = useState<FileCategory>("meeting-minutes");

  const counts = FILE_CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = categorizedFiles[category].length;
      return acc;
    },
    {} as Record<FileCategory, number>,
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <div className="shrink-0">
        <FilesTabStrip
          active={activeTab}
          onChange={setActiveTab}
          counts={counts}
        />
      </div>
      <FileCategorySection
        category={activeTab}
        files={categorizedFiles[activeTab]}
        showHeader={false}
        scrollable
      />
    </div>
  );
}
