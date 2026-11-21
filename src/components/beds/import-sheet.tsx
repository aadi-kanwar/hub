"use client";

import { useEffect, useState } from "react";
import {
  applyImport,
  autoMap,
  nonEmpty,
  parseDate,
  prepareSheet,
  readSpreadsheet,
  type Cell,
  type ImportResult,
  type Target,
  type Workbook,
} from "@/components/beds/excel";
import { formatIso, type Board } from "@/components/beds/model";
import { newFieldKey, type TableDraft } from "@/components/beds/table-view";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet } from "@/components/ui/sheet";

type Loaded = {
  workbook: Workbook;
  sheet: string;
  headers: string[];
  data: { r: Cell[]; line: number }[];
  targets: Target[];
};

/**
 * Import from Excel: read the file, match its columns, then load the rows
 * into the table (highlighted, not saved) for the admin to check and save.
 */
export function ImportSheet({
  file,
  board,
  draft,
  setDraft,
  onPickAnother,
  onClose,
}: {
  file: File;
  board: Board;
  draft: TableDraft;
  setDraft: (d: TableDraft) => void;
  onPickAnother: () => void;
  onClose: () => void;
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const [result, setResult] = useState<ImportResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    readSpreadsheet(file)
      .then((workbook) => {
        if (cancelled) return;
        // The first sheet that has data.
        const first =
          workbook.sheets.find((s) => s.rows.length > 1) ?? workbook.sheets[0];
        if (!first) throw new Error("This file has no sheets.");
        const { headers, data } = prepareSheet(first.rows);
        setLoaded({
          workbook,
          sheet: first.name,
          headers,
          data,
          targets: autoMap(headers, draft.fields),
        });
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const message =
          e instanceof Error && /xlsx or \.csv/.test(e.message)
            ? e.message
            : "This file couldn't be read. Save it as .xlsx or .csv and try again.";
        setError(message);
      });
    return () => {
      cancelled = true;
    };
    // Read once per file; later column changes don't re-read it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);

  const selectSheet = (name: string) => {
    if (!loaded) return;
    const sheet = loaded.workbook.sheets.find((s) => s.name === name);
    if (!sheet) return;
    const { headers, data } = prepareSheet(sheet.rows);
    setLoaded({
      ...loaded,
      sheet: name,
      headers,
      data,
      targets: autoMap(headers, draft.fields),
    });
  };
  const setTarget = (j: number, value: Target) => {
    if (!loaded) return;
    const targets = loaded.targets.map((t, i) =>
      i !== j && value && value !== "__new" && t === value ? "" : t,
    );
    targets[j] = value;
    setLoaded({ ...loaded, targets });
  };
  const sample = (j: number) => {
    for (const d of loaded?.data ?? []) {
      const v = d.r[j];
      if (nonEmpty(v)) {
        if (v instanceof Date) {
          const iso = parseDate(v);
          return iso ? formatIso(iso) : "";
        }
        return String(v).slice(0, 40);
      }
    }
    return "";
  };
  const apply = () => {
    if (!loaded) return;
    const out = applyImport(
      draft,
      board,
      loaded.headers,
      loaded.data,
      loaded.targets,
      mode,
      newFieldKey,
    );
    setDraft(out.draft);
    setResult(out.result);
  };

  let body: React.ReactNode;
  let footer: React.ReactNode = (
    <Button variant="secondary" onClick={onClose}>
      Cancel
    </Button>
  );
  if (error) {
    body = <Banner tone="danger">{error}</Banner>;
    footer = (
      <>
        <Button onClick={onPickAnother}>Choose another file</Button>
        {footer}
      </>
    );
  } else if (!loaded) {
    body = <p role="status">Reading the file…</p>;
  } else if (result) {
    body = (
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-base">
          <strong>{result.added}</strong> new{" "}
          {result.added === 1 ? "tenant" : "tenants"},{" "}
          <strong>{result.updated}</strong> updated
          {result.cleared ? (
            <>
              , <strong>{result.cleared}</strong>{" "}
              {result.cleared === 1 ? "bed" : "beds"} marked vacant
            </>
          ) : null}
          {result.cols ? (
            <>
              , <strong>{result.cols}</strong> new{" "}
              {result.cols === 1 ? "column" : "columns"} (hidden from wardens
              until you allow it)
            </>
          ) : null}
          .
        </p>
        <p className="text-foreground-secondary">
          They&apos;re loaded into the table and highlighted. Check them, then
          press Save changes. Nothing is saved yet.
        </p>
        {result.skipped.length > 0 ? (
          <>
            <h3 className="font-semibold">
              {result.skipped.length}{" "}
              {result.skipped.length === 1 ? "row wasn't" : "rows weren't"}{" "}
              imported
            </h3>
            <ul className="flex flex-col gap-1.5">
              {result.skipped.slice(0, 40).map((s) => (
                <li key={s.line} className="flex gap-3">
                  <span className="min-w-16 whitespace-nowrap text-foreground-secondary">
                    Row {s.line}
                  </span>
                  {s.why}
                </li>
              ))}
              {result.skipped.length > 40 ? (
                <li>and {result.skipped.length - 40} more</li>
              ) : null}
            </ul>
          </>
        ) : null}
      </div>
    );
    footer = (
      <>
        <Button onClick={onClose}>Review in table</Button>
        <Button variant="secondary" onClick={onPickAnother}>
          Import another file
        </Button>
      </>
    );
  } else if (loaded.headers.length === 0) {
    body = (
      <Banner tone="danger">
        No header row found on this sheet. The first row should have column
        names like Room, Bed and Name.
      </Banner>
    );
  } else {
    const hasRoom = loaded.targets.includes("room");
    body = (
      <div className="flex flex-col gap-4 text-sm">
        <p>
          {loaded.data.length} {loaded.data.length === 1 ? "row" : "rows"} found
          {loaded.workbook.sheets.length > 1 ? " on this sheet" : ""}.
        </p>
        {loaded.workbook.sheets.length > 1 ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor="import-sheet" className="font-medium">
              Sheet
            </label>
            <NativeSelect
              id="import-sheet"
              value={loaded.sheet}
              onChange={(e) => selectSheet(e.target.value)}
            >
              {loaded.workbook.sheets.map((s) => (
                <option key={s.name}>{s.name}</option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
        <div className="flex flex-col gap-1">
          <h3 className="font-semibold">Match your columns</h3>
          <p className="text-foreground-secondary">
            Pick where each column should go. Room is required. Without a Bed
            column, tenants fill the room&apos;s free beds in order.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          {loaded.headers.map((h, j) => (
            <div
              key={j}
              className="grid grid-cols-2 items-center gap-3 border-b border-border pb-2"
            >
              <div className="min-w-0">
                <p className="truncate font-semibold">
                  {h || `Column ${j + 1}`}
                </p>
                <p className="truncate text-xs text-foreground-secondary">
                  {sample(j) || "empty"}
                </p>
              </div>
              <div>
                <label htmlFor={`map-${j}`} className="sr-only">
                  Where {h || "this column"} goes
                </label>
                <NativeSelect
                  id={`map-${j}`}
                  className="h-10 text-sm"
                  value={loaded.targets[j] ?? ""}
                  onChange={(e) => setTarget(j, e.target.value)}
                >
                  <option value="">Don&apos;t import</option>
                  <option value="room">Room</option>
                  <option value="bed">Bed</option>
                  <option value="status">Status</option>
                  {draft.fields.map((f) => (
                    <option key={f.k} value={f.k}>
                      {f.label}
                    </option>
                  ))}
                  <option value="__new">Add as a new column</option>
                </NativeSelect>
              </div>
            </div>
          ))}
        </div>
        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-semibold">How to import</legend>
          {(
            [
              [
                "merge",
                "Add and update.",
                "Tenants in the file are added or updated. Everyone else stays as they are.",
              ],
              [
                "replace",
                "Replace.",
                "The file becomes the full tenant list. Beds not in the file are marked vacant.",
              ],
            ] as const
          ).map(([value, title, text]) => (
            <label
              key={value}
              className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3"
            >
              <input
                type="radio"
                name="import-mode"
                className="mt-1 size-4 accent-[var(--color-primary)]"
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>
                <strong>{title}</strong> {text}
              </span>
            </label>
          ))}
        </fieldset>
        {!hasRoom ? (
          <Banner tone="danger">
            Choose which column has the room number.
          </Banner>
        ) : null}
        <p className="text-xs text-foreground-secondary">
          Tip: Download Excel gives you a sheet with every room and bed. Fill it
          in and import it back.
        </p>
      </div>
    );
    footer = (
      <>
        <Button disabled={!hasRoom} onClick={apply}>
          Load into table
        </Button>
        {footer}
      </>
    );
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Import from Excel"
      description={file.name}
      footer={footer}
    >
      {body}
    </Sheet>
  );
}
