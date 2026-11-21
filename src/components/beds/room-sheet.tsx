"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  bedsOf,
  ROOM_TYPE_LABELS,
  ROOM_TYPES,
  roomNoProblem,
  splitBedId,
  type RoomType,
} from "@convex/lib/bedBoard";
import { StatusSwatch } from "@/components/beds/board";
import { bedInfo, type BedMap, type Board } from "@/components/beds/model";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

/** One room's number, floor and number of beds (admins). */
export function RoomSheet({
  propertyId,
  board,
  beds,
  roomNo,
  locked,
  onOpenBed,
  onRenamed,
  onClose,
}: {
  propertyId: Id<"properties">;
  board: Board;
  beds: BedMap;
  roomNo: string;
  locked: boolean;
  onOpenBed: (id: string) => void;
  onRenamed: (no: string) => void;
  onClose: () => void;
}) {
  const saveRoom = useMutation(api.bedBoard.saveRoom);
  const room = board.rooms.find((r) => r.no === roomNo);
  const [no, setNo] = useState(room?.no ?? "");
  const [floor, setFloor] = useState(room?.floor ?? 0);
  const [type, setType] = useState<RoomType>(room?.type ?? 2);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (room === undefined) return null;

  const submit = async () => {
    const trimmed = no.trim();
    const problem = roomNoProblem(trimmed);
    if (problem) return setError(problem);
    const lost = bedsOf(room)
      .slice(type)
      .filter((id) => beds.has(id));
    if (lost.length > 0) {
      return setError(
        `Bed ${lost.map((id) => splitBedId(id).letter).join(" and ")} still has someone assigned. Move or vacate them before making this a ${ROOM_TYPE_LABELS[type].toLowerCase()} room.`,
      );
    }
    setBusy(true);
    setError(null);
    try {
      await saveRoom({ propertyId, oldNo: room.no, no: trimmed, floor, type });
      toast.success("Room saved");
      onRenamed(trimmed);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={`Room ${room.no}`}
      description="Change the room number, floor or how many beds it has. Tenants stay with their beds."
      footer={
        locked ? (
          <p className="text-sm text-foreground-secondary">
            Save or discard your table changes before changing rooms.
          </p>
        ) : (
          <>
            <Button loading={busy} onClick={submit}>
              Save room
            </Button>
            <Button variant="secondary" disabled={busy} onClick={onClose}>
              Cancel
            </Button>
          </>
        )
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <Field id="room-no" label="Room number">
            {(p) => (
              <Input
                {...p}
                value={no}
                onChange={(e) => setNo(e.target.value)}
                autoComplete="off"
              />
            )}
          </Field>
          <Field id="room-floor" label="Floor">
            {(p) => (
              <NativeSelect
                {...p}
                value={floor}
                onChange={(e) => setFloor(Number(e.target.value))}
              >
                {[...board.floors]
                  .sort((a, b) => a.n - b.n)
                  .map((f) => (
                    <option key={f.n} value={f.n}>
                      {f.name}
                    </option>
                  ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        <Field id="room-type" label="Room type">
          {(p) => (
            <NativeSelect
              {...p}
              value={type}
              onChange={(e) => setType(Number(e.target.value) as RoomType)}
            >
              {ROOM_TYPES.map((t) => (
                <option key={t} value={t}>
                  {ROOM_TYPE_LABELS[t]} ({t} {t === 1 ? "bed" : "beds"})
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <ul className="flex flex-col gap-2">
          {bedsOf(room).map((id) => {
            const info = bedInfo(beds, id);
            return (
              <li key={id}>
                <button
                  type="button"
                  onClick={() => onOpenBed(id)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-sm border border-border bg-subtle px-3 text-left text-sm hover:bg-muted"
                >
                  <StatusSwatch status={info.status} />
                  Bed {splitBedId(id).letter}:{" "}
                  {String(info.tenant?.name ?? "Vacant")}
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </Sheet>
  );
}
