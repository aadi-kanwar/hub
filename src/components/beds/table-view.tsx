"use client";

import { useMutation } from "convex/react";
import { Columns3, Download, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  BED_LETTERS,
  BED_STATUSES,
  byRoomNo,
  cleanNumber,
  ROOM_TYPE_LABELS,
  STATUS_LABELS,
  tenantProblems,
  type BedStatus,
  type Field,
  type Room,
} from "@convex/lib/bedBoard";
import { StatusSwatch } from "@/components/beds/board";
import { ColumnsSheet } from "@/components/beds/columns-sheet";
import { convertIn, downloadExcel, parseStatus } from "@/components/beds/excel";
import { ImportSheet } from "@/components/beds/import-sheet";
import type { Board } from "@/components/beds/model";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { inputClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";
import { cn } from "@/lib/utils";

/** A bed as the table edits it: every value is text until saved. */
export type DraftBed = { status: BedStatus; tenant: Record<string, string> };
/** Unsaved table changes: the columns and every bed, based on the board at `baseVersion`. */
export type TableDraft = {
  baseVersion: number;
  fields: Field[];
  beds: Record<string, DraftBed>;
};

export function startDraft(board: Board): TableDraft {
  return {
    baseVersion: board.version,
    fields: board.fields.map((f) => ({
      ...f,
      on: [...f.on],
      options: f.options ? [...f.options] : undefined,
    })),
    beds: Object.fromEntries(
      board.beds.map((b) => [
        b.bedId,
        {
          status: b.status,
          tenant: Object.fromEntries(
            Object.entries(b.tenant).map(([k, v]) => [k, String(v)]),
          ),
        },
      ]),
    ),
  };
}

type Row = { id: string; room: Room; letter: string };

function allRows(board: Board): Row[] {
  return [...board.rooms]
    .sort(byRoomNo)
    .flatMap((room) =>
      BED_LETTERS.slice(0, room.type).map((letter) => ({
        id: `${room.no}-${letter}`,
        room,
        letter,
      })),
    );
}

function cellValue(
  beds: Record<string, DraftBed>,
  id: string,
  k: string,
): string {
  const b = beds[id];
  if (k === "status") return b?.status ?? "vacant";
  if (!b || b.status === "vacant") return "";
  return b.tenant[k] ?? "";
}

function changedCells(draft: TableDraft, board: Board): number {
  const saved = startDraft(board).beds;
  const keys = ["status", ...draft.fields.map((f) => f.k)];
  let n = 0;
  for (const row of allRows(board))
    for (const k of keys)
      if (cellValue(draft.beds, row.id, k) !== cellValue(saved, row.id, k))
        n += 1;
  return n;
}

const fieldsChanged = (draft: TableDraft, board: Board) =>
  JSON.stringify(draft.fields) !== JSON.stringify(startDraft(board).fields);

export function draftIsDirty(draft: TableDraft, board: Board): boolean {
  return fieldsChanged(draft, board) || changedCells(draft, board) > 0;
}

function rowProblems(draft: TableDraft, id: string): Record<string, string> {
  const b = draft.beds[id];
  if (!b || b.status === "vacant") return {};
  return tenantProblems(b.status, b.tenant, draft.fields);
}

/** Sets one cell; typing into a vacant row starts an occupied tenant. */
function setCell(
  draft: TableDraft,
  id: string,
  k: string,
  value: string,
): TableDraft {
  const beds = { ...draft.beds };
  const b = beds[id]
    ? { status: beds[id].status, tenant: { ...beds[id].tenant } }
    : undefined;
  if (k === "status") {
    if (!b) {
      if (value !== "vacant")
        beds[id] = { status: value as BedStatus, tenant: {} };
    } else beds[id] = { ...b, status: value as BedStatus };
    return { ...draft, beds };
  }
  if (!b) {
    if (value === "") return draft;
    beds[id] = { status: "occupied", tenant: { [k]: value } };
  } else {
    if (b.status === "vacant" && value !== "") b.status = "occupied";
    b.tenant[k] = value;
    beds[id] = b;
  }
  return { ...draft, beds };
}

let keyCounter = 0;
export const newFieldKey = () =>
  `c${Date.now().toString(36)}${(keyCounter++).toString(36)}`;

/** The table: every bed in one sheet, edited like a spreadsheet and saved in one go. */
export function TableView({
  propertyId,
  board,
  draft,
  setDraft,
}: {
  propertyId: Id<"properties">;
  board: Board;
  draft: TableDraft | null;
  setDraft: (d: TableDraft | null) => void;
}) {
  const saveTable = useMutation(api.bedBoard.saveTable);
  const d = useMemo(() => draft ?? startDraft(board), [draft, board]);
  const saved = useMemo(() => startDraft(board).beds, [board]);
  const [query, setQuery] = useState("");
  const [floor, setFloor] = useState<string>("all");
  const [status, setStatus] = useState<string>("all");
  const [sort, setSort] = useState<{ k: string; dir: 1 | -1 }>({
    k: "room",
    dir: 1,
  });
  const [busy, setBusy] = useState(false);
  const [panel, setPanel] = useState<"columns" | "import" | null>(null);
  const [importFile, setImportFile] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const tableRef = useRef<HTMLDivElement>(null);
  const editable = board.canEdit;

  const update = (fn: (current: TableDraft) => TableDraft) => setDraft(fn(d));
  const cols: (Field | { k: "status"; label: string; type: "status" })[] = [
    { k: "status", label: "Status", type: "status" },
    ...d.fields,
  ];

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = allRows(board).filter((row) => {
      if (floor !== "all" && String(row.room.floor) !== floor) return false;
      const b = d.beds[row.id];
      if (status !== "all" && (b?.status ?? "vacant") !== status) return false;
      if (q) {
        const hay =
          `${row.id} ${Object.values(b?.tenant ?? {}).join(" ")}`.toLowerCase();
        if (
          !hay.includes(q) &&
          !hay.replace(/\s/g, "").includes(q.replace(/\s/g, ""))
        )
          return false;
      }
      return true;
    });
    const f = d.fields.find((x) => x.k === sort.k);
    const byRoom = (a: Row, b: Row) =>
      byRoomNo(a.room, b.room) || a.letter.localeCompare(b.letter);
    return list.sort((a, b) => {
      if (sort.k === "room") return sort.dir * byRoom(a, b);
      const va = cellValue(d.beds, a.id, sort.k);
      const vb = cellValue(d.beds, b.id, sort.k);
      if (!va && vb) return 1;
      if (va && !vb) return -1;
      const c =
        f && (f.type === "money" || f.type === "number")
          ? Number(cleanNumber(va)) - Number(cleanNumber(vb))
          : va.localeCompare(vb, undefined, { numeric: true });
      return c * sort.dir || byRoom(a, b);
    });
  }, [board, d, query, floor, status, sort]);
  const rowIds = rows.map((r) => r.id);

  const dirty = draft !== null && draftIsDirty(draft, board);
  const changes = draft ? changedCells(draft, board) : 0;
  const badRows = allRows(board).filter(
    (r) => Object.keys(rowProblems(d, r.id)).length > 0,
  );
  const stale = draft !== null && draft.baseVersion !== board.version;

  const save = async () => {
    if (badRows.length > 0) {
      setQuery("");
      setFloor("all");
      setStatus("all");
      toast.error("Fix the cells outlined in red first.");
      requestAnimationFrame(() => {
        const el = tableRef.current?.querySelector<HTMLElement>(
          "[aria-invalid=true]",
        );
        el?.focus();
        el?.scrollIntoView({ block: "center", inline: "center" });
      });
      return;
    }
    setBusy(true);
    try {
      const fields = d.fields.map((f) => ({
        ...f,
        label: f.label.trim() || "Untitled column",
      }));
      const beds = Object.entries(d.beds)
        .filter(([, b]) => b.status !== "vacant")
        .map(([bedId, b]) => ({
          bedId,
          status: b.status as Exclude<BedStatus, "vacant">,
          tenant: b.tenant,
        }));
      const { changed } = await saveTable({
        propertyId,
        baseVersion: d.baseVersion,
        fields,
        beds,
      });
      setDraft(null);
      toast.success(
        changed === 0
          ? "Table saved"
          : `Table saved: ${changed} ${changed === 1 ? "bed" : "beds"} changed`,
      );
    } catch (e) {
      toast.error(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };

  const onPaste = (e: React.ClipboardEvent<HTMLDivElement>) => {
    const key = (e.target as HTMLElement).getAttribute?.("data-cell");
    if (!key || !editable) return;
    const text = e.clipboardData
      .getData("text")
      .replace(/\r/g, "")
      .replace(/\n$/, "");
    if (!/[\t\n]/.test(text)) return;
    e.preventDefault();
    const [id0, k0] = key.split("|");
    const grid = text.split("\n").map((line) => line.split("\t"));
    const keys = cols.map((c) => c.k);
    const r0 = rowIds.indexOf(id0);
    const c0 = keys.indexOf(k0);
    let next = d;
    let n = 0;
    grid.forEach((line, i) => {
      const id = rowIds[r0 + i];
      if (!id) return;
      line.forEach((value, j) => {
        const k = keys[c0 + j];
        if (!k) return;
        if (k === "status") {
          const s = parseStatus(value);
          if (s) {
            next = setCell(next, id, k, s);
            n += 1;
          }
          return;
        }
        next = setCell(
          next,
          id,
          k,
          convertIn(
            d.fields.find((f) => f.k === k),
            value,
          ),
        );
        n += 1;
      });
    });
    setDraft(next);
    toast.success(`Pasted ${n} ${n === 1 ? "cell" : "cells"}`);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const el = e.target as HTMLInputElement;
    const key = el.getAttribute?.("data-cell");
    if (!key) return;
    const arrowsOk = el.tagName !== "SELECT" && el.type !== "date";
    const down =
      (e.key === "Enter" && !e.shiftKey) || (e.key === "ArrowDown" && arrowsOk);
    const up =
      (e.key === "Enter" && e.shiftKey) || (e.key === "ArrowUp" && arrowsOk);
    if (!down && !up) return;
    e.preventDefault();
    const [id, k] = key.split("|");
    const next = rowIds[rowIds.indexOf(id) + (down ? 1 : -1)];
    if (!next) return;
    const target = tableRef.current?.querySelector<HTMLInputElement>(
      `[data-cell="${CSS.escape(`${next}|${k}`)}"]`,
    );
    target?.focus();
    if (target?.type === "text") target.select();
  };

  const sortButton = (k: string, label: string) => (
    <button
      type="button"
      onClick={() =>
        setSort(
          sort.k === k ? { k, dir: sort.dir === 1 ? -1 : 1 } : { k, dir: 1 },
        )
      }
      className="block w-full px-2.5 py-2.5 text-left font-semibold whitespace-nowrap"
      aria-label={`Sort by ${label}`}
    >
      {label}
      {sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </button>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
        <label htmlFor="table-search" className="sr-only">
          Search the table
        </label>
        <input
          id="table-search"
          type="search"
          className={cn(inputClasses, "lg:max-w-xs")}
          placeholder="Search name, phone, room or any detail"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="grid grid-cols-2 gap-3 sm:flex">
          <div className="sm:w-40">
            <label htmlFor="table-floor" className="sr-only">
              Floor
            </label>
            <NativeSelect
              id="table-floor"
              value={floor}
              onChange={(e) => setFloor(e.target.value)}
            >
              <option value="all">All floors</option>
              {[...board.floors]
                .sort((a, b) => a.n - b.n)
                .map((f) => (
                  <option key={f.n} value={f.n}>
                    {f.name}
                  </option>
                ))}
            </NativeSelect>
          </div>
          <div className="sm:w-40">
            <label htmlFor="table-status" className="sr-only">
              Status
            </label>
            <NativeSelect
              id="table-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
            >
              <option value="all">Any status</option>
              {BED_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {STATUS_LABELS[s]}
                </option>
              ))}
            </NativeSelect>
          </div>
        </div>
        {editable ? (
          <div className="flex flex-wrap gap-2 lg:ml-auto">
            <Button variant="secondary" onClick={() => setPanel("columns")}>
              <Icon icon={Columns3} />
              Columns
            </Button>
            <Button
              variant="secondary"
              onClick={() => fileInput.current?.click()}
            >
              <Icon icon={Upload} />
              Import from Excel
            </Button>
            <Button
              variant="secondary"
              onClick={() => {
                if (dirty)
                  toast(
                    "Downloading the last saved version. Your unsaved table changes aren't included.",
                  );
                downloadExcel(board).catch(() =>
                  toast.error(
                    "The download didn't start. Check your connection and try again.",
                  ),
                );
              }}
            >
              <Icon icon={Download} />
              Download Excel
            </Button>
            <input
              ref={fileInput}
              type="file"
              accept=".xlsx,.csv"
              className="sr-only"
              tabIndex={-1}
              aria-hidden="true"
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                if (file) {
                  setImportFile(file);
                  setPanel("import");
                }
              }}
            />
          </div>
        ) : null}
      </div>
      {editable ? (
        <p className="text-sm text-foreground-secondary">
          Click a cell to edit. Tab moves right, Enter moves down, and you can
          paste a block of cells copied from Excel. Typing in a vacant row
          starts a new tenant. Nothing is saved until you press Save changes.
        </p>
      ) : (
        <p className="text-sm text-foreground-secondary">
          View only. Some details are only visible to admins.
        </p>
      )}
      {stale ? (
        <Banner tone="warning">
          Someone else saved a change to this board after you started editing,
          so saving your table changes will be refused. Discard them to see the
          latest board.
        </Banner>
      ) : null}

      <div
        ref={tableRef}
        onPaste={onPaste}
        onKeyDown={onKeyDown}
        className="max-h-[70vh] overflow-auto rounded-md border border-border bg-surface"
      >
        <table className="min-w-full border-separate border-spacing-0 text-sm">
          <thead>
            <tr>
              <th
                scope="col"
                className="sticky top-0 left-0 z-30 border-r border-b border-border bg-subtle p-0 text-left"
              >
                {sortButton("room", "Room")}
              </th>
              <th
                scope="col"
                className="sticky top-0 z-20 border-b border-border bg-subtle px-2.5 py-2.5 text-left font-semibold"
              >
                Bed
              </th>
              {cols.map((c) => (
                <th
                  key={c.k}
                  scope="col"
                  className="sticky top-0 z-20 border-b border-border bg-subtle p-0 text-left"
                >
                  {sortButton(
                    c.k,
                    c.label + (c.type === "money" ? " (₹)" : ""),
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={cols.length + 2}
                  className="p-4 text-foreground-secondary"
                >
                  No beds match these filters.
                </td>
              </tr>
            ) : null}
            {rows.map((row) => {
              const b = d.beds[row.id];
              const st: BedStatus = b?.status ?? "vacant";
              const problems = rowProblems(d, row.id);
              const clearing = st === "vacant" && !!saved[row.id];
              return (
                <tr
                  key={row.id}
                  className={cn(
                    st === "vacant" && "bg-subtle",
                    clearing && "line-through decoration-foreground-muted",
                  )}
                >
                  <td className="sticky left-0 z-10 border-r border-b border-border bg-surface px-2.5 py-1.5 font-semibold whitespace-nowrap tabular-nums">
                    <span className="flex items-center gap-2">
                      <StatusSwatch status={st} className="size-4" />
                      {row.room.no}
                    </span>
                    <span className="block pl-6 text-xs font-normal text-foreground-secondary">
                      {ROOM_TYPE_LABELS[row.room.type]}
                    </span>
                  </td>
                  <td className="border-b border-border px-2.5 font-semibold text-foreground-secondary">
                    {row.letter}
                  </td>
                  {cols.map((c) => {
                    const value = cellValue(d.beds, row.id, c.k);
                    const changed = value !== cellValue(saved, row.id, c.k);
                    const problem = problems[c.k];
                    const label = `${c.label}, room ${row.room.no} bed ${row.letter}`;
                    const cellClass = cn(
                      "block w-full min-w-36 border-0 bg-transparent px-2.5 py-2 text-sm text-foreground focus:bg-surface focus:outline-2 focus:-outline-offset-2 focus:outline-ring disabled:cursor-not-allowed disabled:opacity-40",
                      changed && "bg-warning-subtle",
                      problem && "ring-2 ring-danger ring-inset",
                    );
                    if (!editable) {
                      return (
                        <td
                          key={c.k}
                          className="border-b border-border px-2.5 py-2 whitespace-nowrap"
                        >
                          {c.k === "status" ? STATUS_LABELS[st] : value}
                        </td>
                      );
                    }
                    if (c.type === "status") {
                      return (
                        <td key={c.k} className="border-b border-border p-0">
                          <select
                            data-cell={`${row.id}|status`}
                            aria-label={label}
                            className={cn(cellClass, "min-w-28")}
                            value={st}
                            onChange={(e) =>
                              update((cur) =>
                                setCell(cur, row.id, "status", e.target.value),
                              )
                            }
                          >
                            {BED_STATUSES.map((s) => (
                              <option key={s} value={s}>
                                {STATUS_LABELS[s]}
                              </option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    const field = c as Field;
                    const notUsed = st !== "vacant" && !field.on.includes(st);
                    const title =
                      problem ??
                      (notUsed
                        ? `Not used for ${STATUS_LABELS[st].toLowerCase()} beds`
                        : undefined);
                    const common = {
                      "data-cell": `${row.id}|${field.k}`,
                      "aria-label": label,
                      "aria-invalid": problem ? true : undefined,
                      title,
                      disabled: notUsed,
                    } as const;
                    if (field.type === "select") {
                      const options = [
                        ...(field.options ?? []),
                        ...(value && !(field.options ?? []).includes(value)
                          ? [value]
                          : []),
                      ];
                      return (
                        <td key={c.k} className="border-b border-border p-0">
                          <select
                            {...common}
                            className={cn(cellClass, "min-w-28")}
                            value={value}
                            onChange={(e) =>
                              update((cur) =>
                                setCell(cur, row.id, field.k, e.target.value),
                              )
                            }
                          >
                            <option value="" />
                            {options.map((o) => (
                              <option key={o}>{o}</option>
                            ))}
                          </select>
                        </td>
                      );
                    }
                    // Empty date cells stay blank (no "mm/dd/yyyy") until clicked; then the date picker appears.
                    const isDate =
                      field.type === "date" &&
                      (value === "" || /^\d{4}-\d{2}-\d{2}$/.test(value));
                    const asDate = isDate && value !== "";
                    const wide =
                      field.type === "textarea" ||
                      field.k === "name" ||
                      field.k === "emergency";
                    const narrow = ["date", "money", "number", "tel"].includes(
                      field.type,
                    );
                    return (
                      <td key={c.k} className="border-b border-border p-0">
                        <input
                          {...common}
                          type={asDate ? "date" : "text"}
                          inputMode={
                            field.type === "money" || field.type === "number"
                              ? "decimal"
                              : field.type === "tel"
                                ? "tel"
                                : undefined
                          }
                          autoComplete="off"
                          className={cn(
                            cellClass,
                            wide && "min-w-48",
                            narrow && "min-w-28",
                          )}
                          value={value}
                          onChange={(e) =>
                            update((cur) =>
                              setCell(cur, row.id, field.k, e.target.value),
                            )
                          }
                          onFocus={
                            isDate
                              ? (e) => (e.currentTarget.type = "date")
                              : undefined
                          }
                          onBlur={
                            isDate
                              ? (e) => {
                                  if (e.currentTarget.value === "")
                                    e.currentTarget.type = "text";
                                }
                              : undefined
                          }
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editable && dirty ? (
        <div
          role="status"
          className="sticky bottom-3 z-20 mx-auto flex flex-wrap items-center justify-center gap-3 rounded-md bg-inverse px-4 py-2.5 text-sm text-white shadow-lg"
        >
          <span>
            {changes > 0
              ? `${changes} ${changes === 1 ? "change" : "changes"}`
              : "Column changes"}
            {badRows.length > 0 ? (
              <span className="font-semibold text-warning-border">
                , {badRows.length}{" "}
                {badRows.length === 1 ? "row needs" : "rows need"} fixing
              </span>
            ) : null}{" "}
            not saved yet
          </span>
          <Button loading={busy} onClick={save}>
            Save changes
          </Button>
          <Button
            variant="ghost"
            className="text-white hover:bg-white/10"
            disabled={busy}
            onClick={() => {
              setDraft(null);
              toast("Changes discarded");
            }}
          >
            Discard
          </Button>
        </div>
      ) : null}

      {panel === "columns" ? (
        <ColumnsSheet
          draft={d}
          setDraft={setDraft}
          onClose={() => setPanel(null)}
        />
      ) : null}
      {panel === "import" && importFile ? (
        <ImportSheet
          file={importFile}
          board={board}
          draft={d}
          setDraft={setDraft}
          onPickAnother={() => fileInput.current?.click()}
          onClose={() => {
            setPanel(null);
            setImportFile(null);
          }}
        />
      ) : null}
    </div>
  );
}
