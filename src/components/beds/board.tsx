"use client";

import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  BED_STATUSES,
  bedsOf,
  STATUS_LABELS,
  type BedStatus,
} from "@convex/lib/bedBoard";
import { BedSheet } from "@/components/beds/bed-sheet";
import { LayoutEditor } from "@/components/beds/layout-editor";
import {
  bedMap,
  countBeds,
  STATUS_STYLE,
  type Board,
} from "@/components/beds/model";
import { PlanView } from "@/components/beds/plan-view";
import { RoomSheet } from "@/components/beds/room-sheet";
import {
  draftIsDirty,
  TableView,
  type TableDraft,
} from "@/components/beds/table-view";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { useQuery } from "@/lib/convex";
import { cn } from "@/lib/utils";

type Selection =
  { kind: "bed"; id: string } | { kind: "room"; no: string } | null;

/** One property's bed board: headline, status filter, and the floor plan or the table. */
export function BedBoard({ propertyId }: { propertyId: Id<"properties"> }) {
  const board = useQuery(api.bedBoard.get, { propertyId });
  if (board === undefined) return <LoadingState rows={4} />;
  if (board === null)
    return (
      <EmptyState
        title="Not set up yet"
        description="This property's bed board hasn't been set up yet."
      />
    );
  return <BoardView propertyId={propertyId} board={board} />;
}

/** The board for data already loaded (also used by previews). */
export function BoardView({
  propertyId,
  board,
}: {
  propertyId: Id<"properties">;
  board: Board;
}) {
  const beds = useMemo(() => bedMap(board), [board]);
  const counts = useMemo(
    () => countBeds(board.rooms, beds),
    [board.rooms, beds],
  );
  const [view, setView] = useState<"plan" | "table">("plan");
  const [statusFilter, setStatusFilter] = useState<BedStatus | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);
  const [selection, setSelection] = useState<Selection>(null);
  const [tableDraft, setTableDraft] = useState<TableDraft | null>(null);
  const tableDirty = tableDraft !== null && draftIsDirty(tableDraft, board);

  const singlesFree = board.rooms.filter(
    (r) => r.type === 1 && !beds.has(bedsOf(r)[0]),
  ).length;

  return (
    <div className="flex flex-col gap-5">
      <section className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="flex flex-col gap-2">
          <p className="font-serif text-3xl tracking-tight">
            <span className="rounded-sm bg-warning-subtle px-1.5 text-warning">
              {counts.vacant}
            </span>{" "}
            {counts.vacant === 1 ? "bed" : "beds"} free to book right now
          </p>
          <p className="text-sm text-foreground-secondary">
            {board.rooms.length} rooms, {counts.total} beds across{" "}
            {board.floors.length}{" "}
            {board.floors.length === 1 ? "floor" : "floors"}. {singlesFree}{" "}
            single {singlesFree === 1 ? "room is" : "rooms are"} empty.
            {editingLayout ? null : " Tap any bed to see who is in it."}
          </p>
        </div>
        {editingLayout ? null : (
          <div
            role="group"
            aria-label="Show only beds that are"
            className="flex flex-wrap gap-2"
          >
            {BED_STATUSES.map((s) => {
              const pressed = statusFilter === s;
              return (
                <button
                  key={s}
                  type="button"
                  aria-pressed={pressed}
                  onClick={() => setStatusFilter(pressed ? null : s)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-full border bg-surface px-4 text-sm transition-colors hover:bg-subtle",
                    pressed
                      ? "border-foreground ring-1 ring-foreground"
                      : "border-border-strong",
                  )}
                >
                  <StatusSwatch status={s} />
                  {STATUS_LABELS[s]}
                  <span className="font-semibold tabular-nums">
                    {counts[s]}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {editingLayout ? (
        <LayoutEditor
          propertyId={propertyId}
          board={board}
          beds={beds}
          onDone={() => setEditingLayout(false)}
        />
      ) : (
        <>
          <div
            role="tablist"
            aria-label="View"
            className="flex gap-1 border-b border-border"
          >
            {(["plan", "table"] as const).map((v) => (
              <button
                key={v}
                role="tab"
                type="button"
                aria-selected={view === v}
                onClick={() => setView(v)}
                className={cn(
                  "-mb-px flex min-h-11 items-center gap-2 border-b-2 px-4 text-sm font-medium",
                  view === v
                    ? "border-primary text-foreground"
                    : "border-transparent text-foreground-secondary hover:text-foreground",
                )}
              >
                {v === "plan" ? "Floor plan" : "Table"}
                {v === "table" && tableDirty ? (
                  <span
                    className="size-2 rounded-full bg-danger"
                    aria-label=", unsaved changes"
                  />
                ) : null}
              </button>
            ))}
          </div>

          {view === "plan" ? (
            <>
              {tableDirty ? (
                <Banner tone="warning">
                  You have unsaved changes in the table. Beds can&apos;t be
                  changed here until you save or discard them.{" "}
                  <Button
                    variant="ghost"
                    className="min-h-0 px-2 underline"
                    onClick={() => setView("table")}
                  >
                    Go to the table
                  </Button>
                </Banner>
              ) : null}
              <PlanView
                board={board}
                beds={beds}
                statusFilter={statusFilter}
                canEditLayout={board.canEdit && !tableDirty}
                onEditLayout={() => {
                  setSelection(null);
                  setStatusFilter(null);
                  setEditingLayout(true);
                  window.scrollTo(0, 0);
                }}
                onOpenBed={(id) => setSelection({ kind: "bed", id })}
                onOpenRoom={(no) => setSelection({ kind: "room", no })}
              />
            </>
          ) : (
            <TableView
              propertyId={propertyId}
              board={board}
              draft={tableDraft}
              setDraft={setTableDraft}
            />
          )}
        </>
      )}

      {selection?.kind === "bed" ? (
        <BedSheet
          key={selection.id}
          propertyId={propertyId}
          board={board}
          beds={beds}
          bedId={selection.id}
          locked={tableDirty}
          onOpenBed={(id) => setSelection({ kind: "bed", id })}
          onClose={() => setSelection(null)}
        />
      ) : null}
      {selection?.kind === "room" ? (
        <RoomSheet
          key={selection.no}
          propertyId={propertyId}
          board={board}
          beds={beds}
          roomNo={selection.no}
          locked={tableDirty}
          onOpenBed={(id) => setSelection({ kind: "bed", id })}
          onRenamed={(no) => setSelection({ kind: "room", no })}
          onClose={() => setSelection(null)}
        />
      ) : null}
    </div>
  );
}

/** The small coloured mark for a status (always shown next to its label or a bed's letter). */
export function StatusSwatch({
  status,
  className,
}: {
  status: BedStatus;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex size-5 shrink-0 items-center justify-center rounded-sm",
        STATUS_STYLE[status].tile,
        className,
      )}
    >
      <Icon icon={STATUS_STYLE[status].icon} className="size-3" />
    </span>
  );
}
