"use client";

import { Pencil } from "lucide-react";
import { useState } from "react";
import {
  bedsOf,
  byRoomNo,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  splitBedId,
  STATUS_LABELS,
  type BedStatus,
} from "@convex/lib/bedBoard";
import { StatusSwatch } from "@/components/beds/board";
import {
  bedInfo,
  countBeds,
  daysFrom,
  formatIso,
  matchesSearch,
  STATUS_STYLE,
  type BedMap,
  type Board,
} from "@/components/beds/model";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { inputClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";

export function PlanView({
  board,
  beds,
  statusFilter,
  canEditLayout,
  onEditLayout,
  onOpenBed,
  onOpenRoom,
}: {
  board: Board;
  beds: BedMap;
  statusFilter: BedStatus | null;
  canEditLayout: boolean;
  onEditLayout: () => void;
  onOpenBed: (id: string) => void;
  onOpenRoom: (no: string) => void;
}) {
  const [floor, setFloor] = useState<number | "all">("all");
  const [type, setType] = useState<number | "all">("all");
  const [query, setQuery] = useState("");
  const floors = [...board.floors].sort((a, b) => a.n - b.n);
  const shownFloors = floors.filter((f) => floor === "all" || f.n === floor);
  const filtering = statusFilter !== null || query.trim() !== "";
  const matches = (id: string) => {
    const info = bedInfo(beds, id);
    return (
      (statusFilter === null || info.status === statusFilter) &&
      matchesSearch(id, info.tenant, query.trim())
    );
  };

  // Coming up: notices ending and bookings starting from 3 days ago to 45 days ahead.
  const upcoming: {
    id: string;
    date: string;
    status: BedStatus;
    text: string;
  }[] = [];
  for (const b of board.beds) {
    const date =
      b.status === "notice"
        ? b.tenant.moveOut
        : b.status === "reserved"
          ? b.tenant.moveIn
          : undefined;
    if (typeof date !== "string") continue;
    const n = daysFrom(date);
    if (n >= -3 && n <= 45)
      upcoming.push({
        id: b.bedId,
        date,
        status: b.status,
        text: b.status === "notice" ? "frees up" : "move-in",
      });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="flex flex-col gap-5">
      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-border bg-background px-4 py-3 md:-mx-8 md:px-8 lg:flex-row lg:flex-wrap lg:items-center">
        <div
          role="group"
          aria-label="Floor"
          className="flex flex-wrap gap-1 rounded-md border border-border bg-surface p-1"
        >
          {[{ n: "all" as const, name: "All floors" }, ...floors].map((f) => (
            <button
              key={String(f.n)}
              type="button"
              aria-pressed={floor === f.n}
              onClick={() => setFloor(f.n)}
              className={cn(
                "min-h-9 rounded-sm px-3 text-sm",
                floor === f.n
                  ? "bg-inverse text-white"
                  : "text-foreground-secondary hover:bg-subtle",
              )}
            >
              {f.name}
            </button>
          ))}
        </div>
        <div className="flex flex-1 flex-col gap-3 sm:flex-row">
          <div className="sm:w-48">
            <label htmlFor="plan-type" className="sr-only">
              Room type
            </label>
            <NativeSelect
              id="plan-type"
              value={String(type)}
              onChange={(e) =>
                setType(
                  e.target.value === "all" ? "all" : Number(e.target.value),
                )
              }
            >
              <option value="all">All room types</option>
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TYPE_LABELS[t]} rooms
                </option>
              ))}
            </NativeSelect>
          </div>
          <label htmlFor="plan-search" className="sr-only">
            Search tenants
          </label>
          <input
            id="plan-search"
            type="search"
            className={cn(inputClasses, "sm:flex-1")}
            placeholder="Search name, phone or room"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {board.canEdit ? (
            <Button
              variant="secondary"
              onClick={onEditLayout}
              disabled={!canEditLayout}
              title={
                canEditLayout
                  ? undefined
                  : "Save or discard your table changes first"
              }
            >
              <Icon icon={Pencil} />
              Edit layout
            </Button>
          ) : null}
        </div>
      </div>

      {upcoming.length > 0 ? (
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <h2 className="shrink-0 text-sm font-semibold">Coming up</h2>
          {upcoming.slice(0, 10).map((u) => {
            const { roomNo, letter } = splitBedId(u.id);
            return (
              <button
                key={u.id}
                type="button"
                onClick={() => onOpenBed(u.id)}
                className="inline-flex min-h-9 shrink-0 items-center gap-2 rounded-sm border border-border bg-surface px-3 text-sm hover:bg-subtle"
              >
                <StatusSwatch status={u.status} className="size-4" />
                {roomNo} {letter} {u.text} {formatIso(u.date, false)}
              </button>
            );
          })}
        </div>
      ) : null}

      {shownFloors.map((f) => {
        const rooms = board.rooms.filter((r) => r.floor === f.n).sort(byRoomNo);
        const shown = rooms.filter((r) => type === "all" || r.type === type);
        const fc = countBeds(rooms, beds);
        return (
          <section
            key={f.n}
            aria-labelledby={`floor-${f.n}`}
            className="flex flex-col gap-3"
          >
            <div className="flex flex-wrap items-baseline gap-x-3">
              <h2
                id={`floor-${f.n}`}
                className="font-serif text-xl tracking-tight"
              >
                {f.name}
              </h2>
              <p className="text-sm text-foreground-secondary">
                {rooms.length} rooms, {fc.total} beds, {fc.vacant} free
              </p>
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(8.5rem,1fr))] gap-2 rounded-md border border-border bg-surface p-3">
              {rooms.length === 0 ? (
                <p className="col-span-full p-2 text-sm text-foreground-secondary">
                  No rooms on this floor yet.
                  {board.canEdit ? " Use Edit layout to add some." : ""}
                </p>
              ) : shown.length === 0 ? (
                <p className="col-span-full p-2 text-sm text-foreground-secondary">
                  No{" "}
                  {type === "all"
                    ? ""
                    : ROOM_TYPE_LABELS[type as 1].toLowerCase()}{" "}
                  rooms on this floor.
                </p>
              ) : null}
              {shown.map((room) => {
                const ids = bedsOf(room);
                const anyMatch = ids.some(matches);
                const free = ids.filter((id) => !beds.has(id)).length;
                return (
                  <div
                    key={room.no}
                    className={cn(
                      "flex flex-col gap-2 rounded-sm border border-border bg-subtle p-2.5 transition-opacity",
                      filtering && !anyMatch && "opacity-30",
                    )}
                  >
                    {board.canEdit ? (
                      <button
                        type="button"
                        onClick={() => onOpenRoom(room.no)}
                        aria-label={`Room ${room.no} settings`}
                        className="group flex items-baseline justify-between gap-2 rounded-sm text-left"
                      >
                        <RoomHeading no={room.no} type={room.type} />
                      </button>
                    ) : (
                      <div className="flex items-baseline justify-between gap-2">
                        <RoomHeading no={room.no} type={room.type} />
                      </div>
                    )}
                    <div className="flex flex-wrap gap-1.5">
                      {ids.map((id) => {
                        const info = bedInfo(beds, id);
                        const { letter } = splitBedId(id);
                        const hit = matches(id);
                        const who =
                          info.status === "vacant"
                            ? "vacant"
                            : `${STATUS_LABELS[info.status].toLowerCase()}${info.tenant?.name ? `, ${info.tenant.name}` : ""}`;
                        return (
                          <button
                            key={id}
                            type="button"
                            onClick={() => onOpenBed(id)}
                            aria-label={`Room ${room.no} bed ${letter}, ${who}`}
                            title={String(info.tenant?.name ?? "Vacant")}
                            className={cn(
                              "relative flex h-14 w-10 flex-col items-center justify-end gap-0.5 rounded-sm pb-1 text-xs font-semibold transition-transform hover:-translate-y-0.5",
                              STATUS_STYLE[info.status].tile,
                              filtering && !hit && "opacity-25",
                              query.trim() !== "" &&
                                hit &&
                                "ring-2 ring-ring ring-offset-2 ring-offset-subtle",
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className="absolute top-1.5 right-1.5 left-1.5 h-2 rounded-sm bg-current opacity-25"
                            />
                            <Icon
                              icon={STATUS_STYLE[info.status].icon}
                              className="size-3"
                            />
                            {letter}
                          </button>
                        );
                      })}
                    </div>
                    {free > 0 ? (
                      <p className="text-xs text-foreground-secondary">
                        {free} free
                      </p>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function RoomHeading({ no, type }: { no: string; type: 1 | 2 | 3 | 4 }) {
  return (
    <>
      <span className="text-lg font-semibold tabular-nums group-hover:underline group-hover:underline-offset-2">
        {no}
      </span>
      <span className="text-xs text-foreground-secondary">
        {ROOM_TYPE_LABELS[type]}
      </span>
    </>
  );
}
