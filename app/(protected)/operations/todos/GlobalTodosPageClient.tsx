"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { AddGlobalTodoDialog } from "@/components/AddGlobalTodoDialog";
import {
  GlobalTodosEmptyHint,
  GlobalTodosList,
  type GlobalTodoItem,
} from "@/components/GlobalTodosList";
import { ConceptLinkProvider } from "@/components/LinkedConceptText";
import type { LinkedConcept } from "@/lib/entities/concept-links";

type Props = {
  items: GlobalTodoItem[];
  archiveItems: GlobalTodoItem[];
  outstanding: number;
  concepts: LinkedConcept[];
};

export function GlobalTodosPageClient({
  items,
  archiveItems,
  outstanding,
  concepts,
}: Props) {
  const router = useRouter();
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [adding, setAdding] = useState(false);

  const handleAddTodo = async (values: {
    assignee: string;
    role: string;
    description: string;
    deadline: string | null;
  }) => {
    setAdding(true);
    try {
      const res = await fetch("/api/global-todos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(values),
      });

      const payload = (await res.json()) as { error?: string };
      if (!res.ok) {
        throw new Error(payload.error || "Could not add to-do.");
      }

      setAddDialogOpen(false);
      router.refresh();
    } finally {
      setAdding(false);
    }
  };

  return (
    <>
      <section className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden">
        <div className="flex shrink-0 flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-500">
              Board checklist
            </p>
            <h1 className="text-2xl font-semibold text-slate-900">
              Global todos ({outstanding} outstanding)
            </h1>
            <div className="mt-2 max-w-2xl">
              <GlobalTodosEmptyHint />
            </div>
          </div>
          <button
            type="button"
            onClick={() => setAddDialogOpen(true)}
            className="rounded-md bg-teal-600 px-4 py-2 text-sm font-semibold text-white shadow hover:bg-teal-700"
          >
            Add new to-do
          </button>
        </div>

        <ConceptLinkProvider concepts={concepts}>
          <GlobalTodosList items={items} archiveItems={archiveItems} />
        </ConceptLinkProvider>
      </section>

      <AddGlobalTodoDialog
        open={addDialogOpen}
        busy={adding}
        onClose={() => {
          if (!adding) setAddDialogOpen(false);
        }}
        onSubmit={handleAddTodo}
      />
    </>
  );
}
