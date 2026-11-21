"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  BED_STATUSES,
  bedsOf,
  ROOM_TYPE_LABELS,
  splitBedId,
  STATUS_LABELS,
  tenantProblems,
  type BedStatus,
  type Field,
  type Tenant,
} from "@convex/lib/bedBoard";
import { StatusSwatch } from "@/components/beds/board";
import {
  bedInfo,
  displayValue,
  formatIso,
  formatMoney,
  relativeDay,
  stayLength,
  todayIso,
  typicalRent,
  type BedMap,
  type Board,
} from "@/components/beds/model";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field as FormField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

type Draft = { status: BedStatus; tenant: Record<string, string> };

const asStrings = (t: Tenant | null): Record<string, string> =>
  Object.fromEntries(Object.entries(t ?? {}).map(([k, v]) => [k, String(v)]));

/** One bed: who is in it, and (for admins) booking, check-in, notice and vacating. */
export function BedSheet({
  propertyId,
  board,
  beds,
  bedId,
  locked,
  onOpenBed,
  onClose,
}: {
  propertyId: Id<"properties">;
  board: Board;
  beds: BedMap;
  bedId: string;
  locked: boolean;
  onOpenBed: (id: string) => void;
  onClose: () => void;
}) {
  const save = useMutation(api.bedBoard.saveBed);
  const { roomNo, letter } = splitBedId(bedId);
  const room = board.rooms.find((r) => r.no === roomNo);
  const info = bedInfo(beds, bedId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirmVacate, setConfirmVacate] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (room === undefined) return null;
  const rent = typicalRent(board.rooms, beds, room.type);

  const start = (status: BedStatus) => {
    const tenant = asStrings(info.tenant);
    if (!tenant.rent) tenant.rent = String(rent);
    if (status === "occupied" && !tenant.checkIn) tenant.checkIn = todayIso();
    if (status === "occupied" && tenant.deposit === undefined)
      tenant.deposit = tenant.rent;
    setDraft({ status, tenant });
    setError(null);
    setConfirmVacate(false);
  };

  const submit = async (
    status: BedStatus,
    tenant: Record<string, string>,
    message: string,
  ) => {
    if (status !== "vacant") {
      const problem = Object.values(
        tenantProblems(status, tenant, board.fields),
      )[0];
      if (problem) {
        setError(problem);
        return;
      }
    }
    setBusy(true);
    setError(null);
    try {
      await save({
        propertyId,
        bedId,
        status,
        tenant: status === "vacant" ? {} : tenant,
      });
      toast.success(message);
      setDraft(null);
      setConfirmVacate(false);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const mates = bedsOf(room).filter((id) => id !== bedId);
  const title = `Room ${roomNo}, bed ${letter}`;
  const description = `${ROOM_TYPE_LABELS[room.type]} room, ${board.floors.find((f) => f.n === room.floor)?.name ?? ""}`;

  // ---- Editing ----
  if (draft) {
    const fields = board.fields.filter(
      (f) => draft.status !== "vacant" && f.on.includes(draft.status),
    );
    return (
      <Sheet
        open
        onOpenChange={(open) => !open && onClose()}
        title={title}
        description={description}
        footer={
          <>
            <Button
              loading={busy}
              onClick={() =>
                submit(
                  draft.status,
                  draft.tenant,
                  draft.status === "vacant"
                    ? "Bed marked vacant"
                    : "Changes saved",
                )
              }
            >
              Save changes
            </Button>
            <Button
              variant="secondary"
              disabled={busy}
              onClick={() => setDraft(null)}
            >
              Cancel
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-4">
          <fieldset className="flex flex-col gap-2">
            <legend className="mb-1.5 text-sm font-medium">Bed status</legend>
            <div className="flex flex-wrap gap-2">
              {BED_STATUSES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={draft.status === s}
                  onClick={() =>
                    setDraft({
                      status: s,
                      tenant:
                        s === "occupied" && !draft.tenant.checkIn
                          ? { ...draft.tenant, checkIn: todayIso() }
                          : draft.tenant,
                    })
                  }
                  className={cn(
                    "inline-flex min-h-11 items-center gap-2 rounded-sm border bg-surface px-3 text-sm",
                    draft.status === s
                      ? "border-foreground ring-1 ring-foreground"
                      : "border-border-strong",
                  )}
                >
                  <StatusSwatch status={s} />
                  {STATUS_LABELS[s]}
                </button>
              ))}
            </div>
          </fieldset>
          {draft.status === "vacant" ? (
            <p className="text-sm text-foreground-secondary">
              Saving will mark this bed vacant and remove the tenant&apos;s
              details.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-x-3 gap-y-4">
              {fields.map((f) => (
                <TenantInput
                  key={f.k}
                  field={f}
                  value={draft.tenant[f.k] ?? ""}
                  onChange={(value) =>
                    setDraft({
                      ...draft,
                      tenant: { ...draft.tenant, [f.k]: value },
                    })
                  }
                />
              ))}
            </div>
          )}
          {error ? <Banner tone="danger">{error}</Banner> : null}
        </div>
      </Sheet>
    );
  }

  // ---- Viewing ----
  const t = info.tenant ?? {};
  let footer: React.ReactNode = null;
  if (board.canEdit) {
    if (locked)
      footer = (
        <p className="text-sm text-foreground-secondary">
          Save or discard your table changes before changing beds here.
        </p>
      );
    else if (info.status === "vacant")
      footer = (
        <>
          <Button onClick={() => start("reserved")}>
            Book for a later date
          </Button>
          <Button variant="secondary" onClick={() => start("occupied")}>
            Check in now
          </Button>
        </>
      );
    else
      footer = (
        <>
          <Button onClick={() => start(info.status)}>Edit details</Button>
          {info.status === "occupied" ? (
            <Button variant="secondary" onClick={() => start("notice")}>
              Record notice
            </Button>
          ) : null}
          {info.status === "notice" ? (
            <Button
              variant="secondary"
              loading={busy}
              onClick={() => {
                const tenant = asStrings(info.tenant);
                delete tenant.moveOut;
                return submit("occupied", tenant, "Notice withdrawn");
              }}
            >
              Withdraw notice
            </Button>
          ) : null}
          {info.status === "reserved" ? (
            <Button
              variant="secondary"
              onClick={() => {
                const tenant = asStrings(info.tenant);
                tenant.checkIn = todayIso();
                if (tenant.deposit === undefined && tenant.rent)
                  tenant.deposit = tenant.rent;
                setDraft({ status: "occupied", tenant });
              }}
            >
              Check in
            </Button>
          ) : null}
          <Button
            variant="ghost"
            className="text-danger-text"
            onClick={() => setConfirmVacate(true)}
          >
            {info.status === "reserved" ? "Cancel booking" : "Mark vacant"}
          </Button>
        </>
      );
  } else {
    footer = (
      <p className="text-sm text-foreground-secondary">
        You can view this board but not change it.
      </p>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title={title}
      description={description}
      footer={footer}
    >
      <div className="flex flex-col gap-4">
        <span className="inline-flex items-center gap-2 font-semibold">
          <StatusSwatch status={info.status} />
          {STATUS_LABELS[info.status]}
        </span>
        {info.status === "vacant" ? (
          <div className="rounded-md border border-warning-border bg-warning-subtle p-4 text-sm">
            This bed is free.
            {board.canEdit
              ? ` Rent for a ${ROOM_TYPE_LABELS[room.type].toLowerCase()} room is usually ${formatMoney(rent)} a month here.`
              : null}
          </div>
        ) : (
          <>
            <div>
              <p className="font-serif text-2xl tracking-tight">
                {String(t.name ?? "Unnamed tenant")}
              </p>
              {t.occupation ? (
                <p className="text-sm text-foreground-secondary">
                  {String(t.occupation)}
                </p>
              ) : null}
            </div>
            <dl className="grid grid-cols-[minmax(7rem,auto)_1fr] gap-x-4 gap-y-2.5 text-sm">
              {board.fields
                .filter(
                  (f) =>
                    info.status !== "vacant" &&
                    f.on.includes(info.status) &&
                    f.k !== "name" &&
                    f.k !== "occupation",
                )
                .map((f) => {
                  const value = t[f.k];
                  const empty = value === undefined || value === "";
                  if (f.k === "rentStatus") {
                    return (
                      <Row key={f.k} label={f.label}>
                        {value === "Paid" ? (
                          "Paid"
                        ) : (
                          <span className="font-semibold text-danger-text">
                            {String(value ?? "Not recorded")}
                          </span>
                        )}
                      </Row>
                    );
                  }
                  if (empty)
                    return f.type === "money" ||
                      f.k === "checkIn" ||
                      f.k === "moveIn" ||
                      f.k === "moveOut" ? (
                      <Row key={f.k} label={f.label}>
                        —
                      </Row>
                    ) : null;
                  return (
                    <Row key={f.k} label={f.label}>
                      <ValueView field={f} value={value} />
                    </Row>
                  );
                })}
            </dl>
          </>
        )}
        {mates.length > 0 ? (
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Roommates</h3>
            <ul className="flex flex-col gap-2">
              {mates.map((id) => {
                const mate = bedInfo(beds, id);
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => onOpenBed(id)}
                      className="flex min-h-11 w-full items-center gap-3 rounded-sm border border-border bg-subtle px-3 text-left text-sm hover:bg-muted"
                    >
                      <StatusSwatch status={mate.status} />
                      Bed {splitBedId(id).letter}:{" "}
                      {String(mate.tenant?.name ?? "Vacant")}
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
        {confirmVacate ? (
          <div
            role="alert"
            className="flex flex-col gap-3 rounded-md border border-danger-border bg-danger-subtle p-4 text-sm"
          >
            <p>
              Mark bed {letter} vacant and delete{" "}
              {String(t.name ?? "this tenant")}&apos;s details?
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="destructive"
                loading={busy}
                onClick={() =>
                  submit(
                    "vacant",
                    {},
                    info.status === "reserved"
                      ? "Booking cancelled"
                      : "Bed marked vacant",
                  )
                }
              >
                Yes, mark vacant
              </Button>
              <Button
                variant="secondary"
                disabled={busy}
                onClick={() => setConfirmVacate(false)}
              >
                Keep tenant
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <Banner tone="danger">{error}</Banner> : null}
      </div>
    </Sheet>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <>
      <dt className="text-foreground-secondary">{label}</dt>
      <dd className="tabular-nums [overflow-wrap:anywhere]">{children}</dd>
    </>
  );
}

function ValueView({ field, value }: { field: Field; value: string | number }) {
  if (field.type === "tel")
    return (
      <a
        className="text-primary-text underline"
        href={`tel:${String(value).replace(/\s/g, "")}`}
      >
        {String(value)}
      </a>
    );
  if (field.type === "date" && typeof value === "string") {
    if (field.k === "checkIn")
      return (
        <>
          {formatIso(value)}{" "}
          <span className="text-foreground-secondary">
            ({stayLength(value)})
          </span>
        </>
      );
    if (field.k === "moveIn")
      return (
        <>
          {formatIso(value)}{" "}
          <span className="text-foreground-secondary">
            ({relativeDay(value)})
          </span>
        </>
      );
    if (field.k === "moveOut")
      return (
        <>
          <strong>{formatIso(value)}</strong>{" "}
          <span className="text-foreground-secondary">
            ({relativeDay(value)})
          </span>
        </>
      );
  }
  if (field.type === "textarea")
    return <span className="whitespace-pre-wrap">{String(value)}</span>;
  return <>{displayValue(field, value)}</>;
}

/** One tenant detail in the bed form. Short ones (dates, amounts) take half the width. */
function TenantInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = `bed-${field.k}`;
  const short = ["date", "money", "number", "tel", "select"].includes(
    field.type,
  );
  return (
    <FormField
      id={id}
      label={`${field.label}${field.type === "money" ? " (₹)" : ""}`}
      className={short ? "col-span-1" : "col-span-2"}
    >
      {(p) =>
        field.type === "select" ? (
          <NativeSelect
            {...p}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          >
            <option value="">Not recorded</option>
            {[
              ...(field.options ?? []),
              ...(value && !(field.options ?? []).includes(value)
                ? [value]
                : []),
            ].map((o) => (
              <option key={o}>{o}</option>
            ))}
          </NativeSelect>
        ) : field.type === "textarea" ? (
          <textarea
            {...p}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="min-h-20 w-full rounded-md border border-border-strong bg-surface px-3 py-2 text-base"
          />
        ) : (
          <Input
            {...p}
            type={
              field.type === "date"
                ? "date"
                : field.type === "tel"
                  ? "tel"
                  : field.type === "money" || field.type === "number"
                    ? "number"
                    : "text"
            }
            inputMode={
              field.type === "money" || field.type === "number"
                ? "decimal"
                : undefined
            }
            min={
              field.type === "money" || field.type === "number" ? 0 : undefined
            }
            autoComplete="off"
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </FormField>
  );
}
