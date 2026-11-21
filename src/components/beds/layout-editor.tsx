"use client";

import { useMutation } from "convex/react";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  BED_LETTERS,
  bedId,
  byRoomNo,
  layoutProblems,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  type Floor,
  type LayoutRoom,
  type RoomType,
} from "@convex/lib/bedBoard";
import {
  bedInfo,
  STATUS_STYLE,
  type BedMap,
  type Board,
} from "@/components/beds/model";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { inputClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** Edit floors and rooms all at once; nothing changes on the board until Save layout. */
export function LayoutEditor({
  propertyId,
  board,
  beds,
  onDone,
}: {
  propertyId: Id<"properties">;
  board: Board;
  beds: BedMap;
  onDone: () => void;
}) {
  const saveLayout = useMutation(api.bedBoard.saveLayout);
  const [floors, setFloors] = useState<Floor[]>(() =>
    board.floors.map((f) => ({ ...f })),
  );
  const [rooms, setRooms] = useState<LayoutRoom[]>(() =>
    board.rooms.map((r) => ({ ...r, orig: r.no })),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [baseVersion] = useState(board.version);

  const takenLetters = (origNo: string) => {
    const room = board.rooms.find((r) => r.no === origNo);
    return room
      ? BED_LETTERS.slice(0, room.type).filter((l) =>
          beds.has(bedId(origNo, l)),
        )
      : [];
  };
  const problems = layoutProblems(floors, rooms, takenLetters);
  const problemCount = Object.keys(problems).length;
  const totalBeds = rooms.reduce((n, r) => n + r.type, 0);
  const sortedFloors = [...floors].sort((a, b) => a.n - b.n);

  const updateRoom = (i: number, patch: Partial<LayoutRoom>) =>
    setRooms(rooms.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const nextRoomNo = (floorN: number) => {
    const used = new Set(rooms.map((r) => r.no.trim().toLowerCase()));
    const nums = rooms
      .filter((r) => r.floor === floorN)
      .map((r) => parseInt(r.no, 10))
      .filter((n) => !Number.isNaN(n));
    let n = nums.length ? Math.max(...nums) + 1 : Math.max(1, floorN) * 100 + 1;
    while (used.has(String(n))) n += 1;
    return String(n);
  };

  const submit = async () => {
    if (problemCount > 0) {
      setError("Fix the rooms marked in red first.");
      document
        .querySelector("[data-bad-room]")
        ?.scrollIntoView({ block: "center" });
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveLayout({
        propertyId,
        baseVersion,
        floors,
        rooms: rooms.map((r) => ({ ...r, no: r.no.trim() })),
      });
      toast.success("Layout saved");
      onDone();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-5">
      <div className="sticky top-0 z-10 -mx-4 flex flex-col gap-3 border-b border-border bg-background px-4 py-3 sm:flex-row sm:items-center sm:justify-between md:-mx-8 md:px-8">
        <p className="text-sm">
          <strong>Editing layout.</strong> {floors.length} floors,{" "}
          {rooms.length} rooms, {totalBeds} beds
          {problemCount > 0 ? (
            <span className="font-semibold text-danger-text">
              . {problemCount}{" "}
              {problemCount === 1 ? "room needs" : "rooms need"} fixing
            </span>
          ) : null}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button loading={busy} onClick={submit}>
            Save layout
          </Button>
          <Button variant="secondary" disabled={busy} onClick={onDone}>
            Discard changes
          </Button>
        </div>
      </div>
      <p className="max-w-prose text-sm text-foreground-secondary">
        Rename floors, add or remove rooms, and set how many beds each room has.
        Tenants stay with their room when you renumber or move it. Rooms and
        beds with someone assigned can&apos;t be removed until they&apos;re
        vacant. Nothing changes on the board until you save.
      </p>
      {error ? <Banner tone="danger">{error}</Banner> : null}

      {sortedFloors.map((f) => {
        const list = rooms
          .map((r, i) => ({ r, i }))
          .filter((x) => x.r.floor === f.n)
          .sort((a, b) => byRoomNo(a.r, b.r));
        const floorBeds = list.reduce((n, x) => n + x.r.type, 0);
        return (
          <section key={f.n} className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <label htmlFor={`floor-name-${f.n}`} className="sr-only">
                Floor name
              </label>
              <input
                id={`floor-name-${f.n}`}
                className={cn(
                  inputClasses,
                  "w-full max-w-64 border-dashed font-serif text-xl",
                )}
                value={f.name}
                maxLength={40}
                onChange={(e) =>
                  setFloors(
                    floors.map((x) =>
                      x.n === f.n ? { ...x, name: e.target.value } : x,
                    ),
                  )
                }
              />
              <p className="text-sm text-foreground-secondary">
                {list.length} rooms, {floorBeds} beds
              </p>
              {list.length === 0 && floors.length > 1 ? (
                <Button
                  variant="ghost"
                  className="text-danger-text"
                  onClick={() => setFloors(floors.filter((x) => x.n !== f.n))}
                >
                  Remove floor
                </Button>
              ) : null}
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2 rounded-md border border-border bg-surface p-3">
              {list.map(({ r, i }) => {
                const taken = r.orig !== undefined ? takenLetters(r.orig) : [];
                const p = problems[i];
                return (
                  <div
                    key={i}
                    data-bad-room={p ? true : undefined}
                    className={cn(
                      "flex flex-col gap-2 rounded-sm border bg-surface p-2.5",
                      p ? "border-danger ring-1 ring-danger" : "border-border",
                    )}
                  >
                    <div className="flex items-center gap-1.5">
                      <label htmlFor={`room-${i}`} className="sr-only">
                        Room number
                      </label>
                      <input
                        id={`room-${i}`}
                        className={cn(
                          inputClasses,
                          "h-9 font-semibold tabular-nums",
                        )}
                        value={r.no}
                        onChange={(e) => updateRoom(i, { no: e.target.value })}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        aria-label={`Remove room ${r.no}`}
                        disabled={taken.length > 0}
                        title={
                          taken.length > 0
                            ? "Vacate this room before removing it"
                            : undefined
                        }
                        onClick={() =>
                          setRooms(rooms.filter((_, j) => j !== i))
                        }
                      >
                        <Icon icon={X} />
                      </Button>
                    </div>
                    <label htmlFor={`room-type-${i}`} className="sr-only">
                      Beds in room {r.no}
                    </label>
                    <NativeSelect
                      id={`room-type-${i}`}
                      className="h-9 text-sm"
                      value={r.type}
                      onChange={(e) =>
                        updateRoom(i, {
                          type: Number(e.target.value) as RoomType,
                        })
                      }
                    >
                      {ROOM_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {ROOM_TYPE_LABELS[t]} ({t} {t === 1 ? "bed" : "beds"})
                        </option>
                      ))}
                    </NativeSelect>
                    {sortedFloors.length > 1 ? (
                      <>
                        <label htmlFor={`room-floor-${i}`} className="sr-only">
                          Floor for room {r.no}
                        </label>
                        <NativeSelect
                          id={`room-floor-${i}`}
                          className="h-9 text-sm"
                          value={r.floor}
                          onChange={(e) =>
                            updateRoom(i, { floor: Number(e.target.value) })
                          }
                        >
                          {sortedFloors.map((ff) => (
                            <option key={ff.n} value={ff.n}>
                              {ff.name || `Floor ${ff.n}`}
                            </option>
                          ))}
                        </NativeSelect>
                      </>
                    ) : null}
                    <div aria-hidden="true" className="flex gap-1">
                      {BED_LETTERS.slice(0, r.type).map((l) => {
                        const status =
                          r.orig !== undefined
                            ? bedInfo(beds, bedId(r.orig, l)).status
                            : "vacant";
                        return (
                          <span
                            key={l}
                            className={cn(
                              "flex h-8 w-6 items-end justify-center rounded-sm pb-0.5 text-[0.7rem] font-semibold",
                              STATUS_STYLE[status].tile,
                            )}
                          >
                            {l}
                          </span>
                        );
                      })}
                    </div>
                    {p ? (
                      <p className="text-xs font-semibold text-danger-text">
                        {p.join(" ")}
                      </p>
                    ) : r.orig === undefined ? (
                      <p className="text-xs text-foreground-secondary">
                        New room
                      </p>
                    ) : taken.length > 0 ? (
                      <p className="text-xs text-foreground-secondary">
                        {taken.length} {taken.length === 1 ? "bed" : "beds"}{" "}
                        taken
                      </p>
                    ) : null}
                  </div>
                );
              })}
              <button
                type="button"
                onClick={() =>
                  setRooms([
                    ...rooms,
                    { no: nextRoomNo(f.n), floor: f.n, type: 2 },
                  ])
                }
                className="flex min-h-36 items-center justify-center gap-2 rounded-sm border border-dashed border-border-strong text-sm font-medium text-foreground-secondary hover:border-foreground hover:text-foreground"
              >
                <Icon icon={Plus} />
                Add room
              </button>
            </div>
          </section>
        );
      })}
      <button
        type="button"
        onClick={() => {
          const n = floors.reduce((m, f) => Math.max(m, f.n), 0) + 1;
          setFloors([...floors, { n, name: `Floor ${n}` }]);
        }}
        className="flex min-h-14 items-center justify-center gap-2 rounded-md border border-dashed border-border-strong text-sm font-medium text-foreground-secondary hover:border-foreground hover:text-foreground"
      >
        <Icon icon={Plus} />
        Add a floor
      </button>
    </div>
  );
}
