"use client";

import { useMemo, useState } from "react";

import { FileCategorySection } from "@/components/FileCategorySection";
import { FilesTabStrip } from "@/components/FilesTabStrip";
import { filterVisibleAttachments } from "@/lib/email/attachment-visibility";
import {
  FILE_CATEGORY_ORDER,
  type CategorizedFiles,
  type FileCategory,
} from "@/lib/email/file-categories";
import { useAttachmentVisibilitySettings } from "@/lib/settings/attachment-visibility-settings";

type Props = {
  categorizedFiles: CategorizedFiles;
};

export function FilesPageClient({ categorizedFiles }: Props) {
  const visibilitySettings = useAttachmentVisibilitySettings();
  const [activeTab, setActiveTab] = useState<FileCategory>("meeting-minutes");

  const visibleCategorizedFiles = useMemo(
    () =>
      FILE_CATEGORY_ORDER.reduce((acc, category) => {
        acc[category] = filterVisibleAttachments(
          categorizedFiles[category],
          "files",
          visibilitySettings,
        );
        return acc;
      }, {} as CategorizedFiles),
    [categorizedFiles, visibilitySettings],
  );

  const counts = FILE_CATEGORY_ORDER.reduce(
    (acc, category) => {
      acc[category] = visibleCategorizedFiles[category].length;
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
        files={visibleCategorizedFiles[activeTab]}
        showHeader={false}
        scrollable
      />
    </div>
  );
}
