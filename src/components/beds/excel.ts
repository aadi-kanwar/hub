/**
 * Excel import and download for the bed board's table. The Excel libraries
 * load only when someone imports or downloads.
 */
import {
  BED_LETTERS,
  bedId,
  bedsOf,
  byRoomNo,
  cleanNumber,
  ROOM_TYPE_LABELS,
  STATUS_LABELS,
  TENANT_STATUSES,
  type BedStatus,
  type Field,
  type FieldType,
  type Room,
} from "@convex/lib/bedBoard";
import { formatIso, todayIso, type Board } from "@/components/beds/model";
import type { DraftBed, TableDraft } from "@/components/beds/table-view";

export type Cell = string | number | boolean | Date | null | undefined;

// ---------------------------------------------------------------------------
// Reading files
// ---------------------------------------------------------------------------

export type Workbook = { sheets: { name: string; rows: Cell[][] }[] };

export async function readSpreadsheet(file: File): Promise<Workbook> {
  if (/\.csv$/i.test(file.name))
    return { sheets: [{ name: "Sheet 1", rows: parseCsv(await file.text()) }] };
  if (!/\.xlsx$/i.test(file.name))
    throw new Error("Save the file as .xlsx or .csv and try again.");
  const { default: readXlsxFile } = await import("read-excel-file/browser");
  const sheets = await readXlsxFile(file);
  return {
    sheets: sheets.map((s) => ({
      name: s.sheet,
      rows: s.data as unknown as Cell[][],
    })),
  };
}

/** A small CSV reader: commas, quoted values (with "" for a quote) and line breaks inside quotes. */
export function parseCsv(text: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: string[] = [];
  let value = "";
  let quoted = false;
  const src = text.replace(/^﻿/, "");
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (quoted) {
      if (c === '"' && src[i + 1] === '"') {
        value += '"';
        i++;
      } else if (c === '"') quoted = false;
      else value += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(value);
      value = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && src[i + 1] === "\n") i++;
      row.push(value);
      rows.push(row);
      row = [];
      value = "";
    } else value += c;
  }
  if (value !== "" || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}

export const nonEmpty = (v: Cell) =>
  !(
    v === null ||
    v === undefined ||
    (typeof v === "string" && v.trim() === "")
  );

/** The header row (the first of the top 15 with at least two values) and the rows under it. */
export function prepareSheet(rows: Cell[][]) {
  const headerIndex = rows
    .slice(0, 15)
    .findIndex((r) => r.filter(nonEmpty).length >= 2);
  if (headerIndex < 0)
    return {
      headers: [] as string[],
      data: [] as { r: Cell[]; line: number }[],
    };
  const headers = rows[headerIndex].map((x) => String(x ?? "").trim());
  const data: { r: Cell[]; line: number }[] = [];
  rows.slice(headerIndex + 1).forEach((r, j) => {
    if (r.some(nonEmpty)) data.push({ r, line: headerIndex + 2 + j });
  });
  const width = Math.max(headers.length, ...data.map((d) => d.r.length));
  while (headers.length < width) headers.push("");
  return { headers, data };
}

// ---------------------------------------------------------------------------
// Understanding values
// ---------------------------------------------------------------------------

const pad = (n: number) => String(n).padStart(2, "0");
function makeDate(y: number, m: number, d: number): string | null {
  if (y < 1900 || y > 2200 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCMonth() !== m - 1) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}
const MONTHS = [
  "jan",
  "feb",
  "mar",
  "apr",
  "may",
  "jun",
  "jul",
  "aug",
  "sep",
  "oct",
  "nov",
  "dec",
];
const monthOf = (s: string) => MONTHS.indexOf(s.slice(0, 3).toLowerCase()) + 1;
const year = (y: number) => (y < 100 ? 2000 + y : y);

/** Dates as Excel or people write them (05-10-2026, 5 Oct 2026, 2026-10-05...). Day first, as in India. */
export function parseDate(v: Cell): string | null {
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return null;
    return makeDate(v.getUTCFullYear(), v.getUTCMonth() + 1, v.getUTCDate());
  }
  if (typeof v === "number") {
    if (v > 20000 && v < 90000) {
      const d = new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86_400_000);
      return makeDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
    }
    return null;
  }
  const s = String(v ?? "").trim();
  let m: RegExpMatchArray | null;
  if ((m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[T\s].*)?$/)))
    return makeDate(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})$/)))
    return makeDate(year(+m[3]), +m[2], +m[1]);
  if (
    (m = s.match(
      /^(\d{1,2})(?:st|nd|rd|th)?[-\s/.]*([A-Za-z]{3,9})[-\s/.,]*(\d{2}|\d{4})$/,
    ))
  )
    return monthOf(m[2]) ? makeDate(year(+m[3]), monthOf(m[2]), +m[1]) : null;
  if (
    (m = s.match(
      /^([A-Za-z]{3,9})[-\s/.]*(\d{1,2})(?:st|nd|rd|th)?,?[-\s/.]*(\d{2}|\d{4})$/,
    ))
  )
    return monthOf(m[1]) ? makeDate(year(+m[3]), monthOf(m[1]), +m[2]) : null;
  return null;
}

export function parseStatus(v: Cell): BedStatus | null {
  const s = String(v ?? "")
    .trim()
    .toLowerCase();
  if (!s) return null;
  if (/notice|leaving|vacating|moving out|exit/.test(s)) return "notice";
  if (/vacan|empty|free|availab/.test(s)) return "vacant";
  if (/book|reserv|upcoming|token|confirmed/.test(s)) return "reserved";
  if (/occup|stay|active|current|living|checked|present|filled|^yes$/.test(s))
    return "occupied";
  return null;
}

export function parseBed(v: Cell): string | null {
  const s = String(v ?? "")
    .trim()
    .toUpperCase()
    .replace(/^BED\s*(NO\.?)?\s*/, "");
  if (/^[A-D]$/.test(s)) return s;
  if (/^[1-4]$/.test(s)) return BED_LETTERS[Number(s) - 1];
  const m = s.match(/([A-D])$/);
  return m ? m[1] : null;
}

/** A value from a file or a paste, in the form the table keeps for `field`. */
export function convertIn(field: Field | undefined, raw: Cell): string {
  if (raw === null || raw === undefined) return "";
  if (!field) return String(raw).trim();
  if (field.type === "date")
    return parseDate(raw) ?? (raw instanceof Date ? "" : String(raw).trim());
  if (field.type === "money" || field.type === "number") {
    if (typeof raw === "number") return String(raw);
    const c = cleanNumber(String(raw));
    return c === "" ? "" : Number.isNaN(Number(c)) ? String(raw).trim() : c;
  }
  if (field.type === "select") {
    const s = String(raw).trim();
    return (
      (field.options ?? []).find((o) => o.toLowerCase() === s.toLowerCase()) ??
      s
    );
  }
  if (raw instanceof Date) {
    const d = parseDate(raw);
    return d ? formatIso(d) : "";
  }
  return String(raw).trim();
}

export function guessType(values: Cell[]): FieldType {
  const v = values.filter(nonEmpty);
  if (v.length === 0) return "text";
  if (
    v.every(
      (x) =>
        x instanceof Date ||
        (typeof x === "string" && /[-/.\s]/.test(x) && parseDate(x) !== null),
    )
  )
    return "date";
  if (
    v.every(
      (x) =>
        typeof x === "number" ||
        /^\s*(₹|rs\.?)?\s*[\d,]+(\.\d+)?\s*$/i.test(String(x)),
    )
  )
    return "number";
  return "text";
}

// ---------------------------------------------------------------------------
// Matching columns
// ---------------------------------------------------------------------------

/** Where a file's column goes: "" (skip), "room", "bed", "status", a column key, or "__new". */
export type Target = string;

const ALIASES: Record<string, string[]> = {
  room: [
    "room",
    "room no",
    "room number",
    "room num",
    "roomno",
    "rm",
    "room #",
  ],
  bed: ["bed", "bed no", "bed number", "bed letter", "cot", "bed id"],
  status: ["status", "bed status", "occupancy", "occupancy status"],
  name: [
    "name",
    "full name",
    "tenant",
    "tenant name",
    "guest",
    "guest name",
    "resident",
    "resident name",
    "student name",
    "occupant",
    "occupant name",
  ],
  phone: [
    "phone",
    "mobile",
    "mobile no",
    "mobile number",
    "phone no",
    "phone number",
    "contact",
    "contact no",
    "contact number",
    "whatsapp",
    "whatsapp number",
    "cell",
  ],
  occupation: [
    "work",
    "college",
    "occupation",
    "company",
    "work or college",
    "profession",
    "organisation",
    "organization",
    "institute",
    "employer",
    "office",
  ],
  moveIn: [
    "move in",
    "move in date",
    "moving in",
    "arrival",
    "arrival date",
    "expected move in",
    "booked for",
  ],
  advance: [
    "advance",
    "booking advance",
    "booking amount",
    "token",
    "token amount",
    "advance paid",
  ],
  checkIn: [
    "check in",
    "checked in",
    "checked in on",
    "check in date",
    "joining",
    "joining date",
    "date of joining",
    "doj",
    "joined",
    "joined on",
    "start date",
  ],
  moveOut: [
    "move out",
    "moving out",
    "moving out on",
    "move out date",
    "leaving",
    "leaving date",
    "vacating",
    "vacating date",
    "checkout",
    "check out",
    "end date",
  ],
  rent: [
    "rent",
    "monthly rent",
    "rent amount",
    "rent per month",
    "monthly fee",
    "fees",
    "monthly charges",
  ],
  deposit: [
    "deposit",
    "security deposit",
    "security",
    "caution deposit",
    "caution money",
  ],
  rentStatus: [
    "rent status",
    "payment status",
    "this month",
    "this months rent",
    "this month s rent",
    "paid",
    "rent paid",
  ],
  idProof: ["id", "id proof", "aadhaar", "aadhar", "id type", "kyc", "id card"],
  emergency: [
    "emergency",
    "emergency contact",
    "guardian",
    "guardian contact",
    "parent",
    "parent contact",
    "parents contact",
    "father",
    "father contact",
    "local guardian",
  ],
  notes: ["notes", "remarks", "comments", "note", "remark"],
  "": [
    "floor",
    "floor no",
    "room type",
    "type",
    "sharing",
    "occupancy type",
    "sr",
    "sr no",
    "s no",
    "sl no",
    "serial",
    "serial no",
    "#",
    "no",
  ],
};

const normalise = (s: string) =>
  s
    .toLowerCase()
    .replace(/\(.*?\)|₹/g, " ")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();

export function autoMap(headers: string[], fields: readonly Field[]): Target[] {
  const look = new Map<string, string>();
  for (const [k, names] of Object.entries(ALIASES)) {
    if (
      k === "" ||
      k === "room" ||
      k === "bed" ||
      k === "status" ||
      fields.some((f) => f.k === k)
    ) {
      for (const n of names) look.set(n, k);
    }
  }
  for (const f of fields) look.set(normalise(f.label), f.k);
  const used = new Set<string>();
  return headers.map((h) => {
    let k = look.get(normalise(h)) ?? "";
    if (k && used.has(k)) k = "";
    if (k) used.add(k);
    return k;
  });
}

// ---------------------------------------------------------------------------
// Applying an import to the table draft
// ---------------------------------------------------------------------------

export type ImportResult = {
  added: number;
  updated: number;
  cleared: number;
  cols: number;
  skipped: { line: number; why: string }[];
};

const hasData = (t: Record<string, string> | undefined) =>
  !!t && Object.values(t).some((v) => String(v).trim() !== "");
const sameName = (a: unknown, b: unknown) =>
  !!a && !!b && String(a).toLowerCase() === String(b).toLowerCase();

/**
 * Loads a file's rows into a copy of the draft. "merge" adds and updates;
 * "replace" makes the file the whole list (other beds become vacant).
 * `saved` is the board as last saved, to tell new tenants from updates.
 */
export function applyImport(
  draft: TableDraft,
  saved: Board,
  headers: string[],
  data: { r: Cell[]; line: number }[],
  targets: Target[],
  mode: "merge" | "replace",
  newKey: () => string,
): { draft: TableDraft; result: ImportResult } {
  const fields = draft.fields.map((f) => ({ ...f }));
  const beds: Record<string, DraftBed> = Object.fromEntries(
    Object.entries(draft.beds).map(([id, b]) => [
      id,
      { status: b.status, tenant: { ...b.tenant } },
    ]),
  );
  const map = [...targets];
  let cols = 0;
  map.forEach((target, j) => {
    if (target !== "__new") return;
    const field: Field = {
      k: newKey(),
      label: (headers[j] || `Column ${j + 1}`).slice(0, 60),
      type: guessType(data.map((d) => d.r[j])),
      on: [...TENANT_STATUSES],
      warden: false,
    };
    fields.push(field);
    map[j] = field.k;
    cols += 1;
  });
  const savedBeds = new Map(saved.beds.map((b) => [b.bedId, b]));
  const roomByNo = (s: string): Room | undefined =>
    saved.rooms.find((r) => r.no.toLowerCase() === s.toLowerCase());
  const col = (k: string) => map.indexOf(k);
  const cRoom = col("room");
  const cBed = col("bed");
  const cStatus = col("status");
  const cName = col("name");
  const result: ImportResult = {
    added: 0,
    updated: 0,
    cleared: 0,
    cols,
    skipped: [],
  };
  const taken = new Set<string>();
  const skip = (line: number, why: string) =>
    result.skipped.push({ line, why });

  if (mode === "replace")
    for (const b of Object.values(beds)) b.status = "vacant";

  for (const { r: row, line } of data) {
    const rs = String(row[cRoom] ?? "")
      .trim()
      .replace(/^room\s*(no\.?|number|#)?\s*/i, "");
    if (!rs) {
      skip(line, "No room number");
      continue;
    }
    let room = roomByNo(rs);
    let bedHint: string | null = null;
    if (!room) {
      const m = rs.match(/^(.+?)[-\s/]*([A-Da-d])$/);
      if (m && roomByNo(m[1])) {
        room = roomByNo(m[1]);
        bedHint = m[2].toUpperCase();
      }
    }
    if (!room) {
      skip(line, `Room ${rs} isn't on the floor plan`);
      continue;
    }
    const name = cName >= 0 ? String(row[cName] ?? "").trim() : "";
    const rawStatus = cStatus >= 0 ? row[cStatus] : "";
    let status = parseStatus(rawStatus);
    if (cStatus >= 0 && nonEmpty(rawStatus) && !status) {
      skip(
        line,
        `Status "${String(rawStatus).trim()}" isn't one of Occupied, Vacant, Booked or On notice`,
      );
      continue;
    }
    if (!status) status = name ? "occupied" : null;
    if (!status) {
      skip(line, "No tenant name");
      continue;
    }
    let id: string | null = null;
    const letter =
      cBed >= 0 && nonEmpty(row[cBed]) ? parseBed(row[cBed]) : bedHint;
    if (cBed >= 0 && nonEmpty(row[cBed]) && !letter) {
      skip(
        line,
        `Bed "${String(row[cBed]).trim()}" should be A, B, C or 1, 2, 3`,
      );
      continue;
    }
    if (letter) {
      if (BED_LETTERS.indexOf(letter as "A") >= room.type) {
        skip(
          line,
          `Room ${room.no} is a ${ROOM_TYPE_LABELS[room.type].toLowerCase()} room and has no bed ${letter}`,
        );
        continue;
      }
      id = bedId(room.no, letter);
      if (taken.has(id)) {
        skip(line, `Room ${room.no} bed ${letter} appears twice in the file`);
        continue;
      }
      const existing = beds[id];
      if (
        mode === "merge" &&
        status !== "vacant" &&
        existing &&
        existing.status !== "vacant" &&
        name &&
        existing.tenant.name &&
        !sameName(existing.tenant.name, name)
      ) {
        skip(
          line,
          `Room ${room.no} bed ${letter} already has ${existing.tenant.name}. Use Replace, or mark that bed vacant first`,
        );
        continue;
      }
    } else {
      const candidates = bedsOf(room);
      if (name)
        id =
          candidates.find(
            (b) => !taken.has(b) && sameName(beds[b]?.tenant.name, name),
          ) ?? null;
      if (!id && status !== "vacant")
        id =
          candidates.find(
            (b) =>
              !taken.has(b) &&
              (!beds[b] || beds[b].status === "vacant") &&
              !(
                mode === "merge" &&
                hasData(beds[b]?.tenant) &&
                savedBeds.has(b)
              ),
          ) ??
          candidates.find(
            (b) => !taken.has(b) && (!beds[b] || beds[b].status === "vacant"),
          ) ??
          null;
      if (!id) {
        skip(
          line,
          status === "vacant"
            ? `Say which bed in room ${room.no} to mark vacant`
            : `Room ${room.no} has no free bed for ${name || "this tenant"}`,
        );
        continue;
      }
    }
    taken.add(id);
    let bed = beds[id];
    if (status === "vacant") {
      if (bed) bed.status = "vacant";
      result.cleared += 1;
      continue;
    }
    const same = !!bed && sameName(bed.tenant.name, name);
    if (!bed) bed = beds[id] = { status, tenant: {} };
    if (!same && cName >= 0) bed.tenant = {};
    bed.status = status;
    map.forEach((target, j) => {
      if (
        !target ||
        target === "room" ||
        target === "bed" ||
        target === "status"
      )
        return;
      if (!nonEmpty(row[j])) return;
      bed!.tenant[target] = convertIn(
        fields.find((f) => f.k === target),
        row[j],
      );
    });
    if (sameName(savedBeds.get(id)?.tenant.name, name)) result.updated += 1;
    else result.added += 1;
  }
  if (mode === "replace") {
    for (const room of saved.rooms) {
      for (const id of bedsOf(room)) {
        if (
          beds[id]?.status === "vacant" &&
          savedBeds.has(id) &&
          !taken.has(id)
        )
          result.cleared += 1;
      }
    }
  }
  return { draft: { ...draft, fields, beds }, result };
}

// ---------------------------------------------------------------------------
// Download
// ---------------------------------------------------------------------------

/** Downloads the saved board as an Excel file: one row per bed. */
export async function downloadExcel(board: Board): Promise<void> {
  const { default: writeXlsxFile } = await import("write-excel-file/browser");
  const fields = board.fields;
  const header = [
    "Room",
    "Bed",
    "Floor",
    "Room type",
    "Status",
    ...fields.map((f) => f.label + (f.type === "money" ? " (₹)" : "")),
  ];
  const beds = new Map(board.beds.map((b) => [b.bedId, b]));
  const floorName = (n: number) =>
    board.floors.find((f) => f.n === n)?.name ?? `Floor ${n}`;
  type CellOut = {
    value?: string | number | Date;
    type?: StringConstructor | NumberConstructor | DateConstructor;
    format?: string;
    fontWeight?: "bold";
  } | null;
  const rows: CellOut[][] = [
    header.map((h) => ({ value: h, fontWeight: "bold" as const })),
  ];
  for (const room of [...board.rooms].sort(byRoomNo)) {
    for (const id of bedsOf(room)) {
      const bed = beds.get(id);
      const row: CellOut[] = [
        /^\d+$/.test(room.no)
          ? { value: Number(room.no), type: Number }
          : { value: room.no },
        { value: id.slice(id.lastIndexOf("-") + 1) },
        { value: floorName(room.floor) },
        { value: ROOM_TYPE_LABELS[room.type] },
        { value: STATUS_LABELS[bed?.status ?? "vacant"] },
      ];
      for (const f of fields) {
        const v = bed?.tenant[f.k];
        if (v === undefined || v === "") row.push(null);
        else if (
          f.type === "date" &&
          typeof v === "string" &&
          /^\d{4}-\d{2}-\d{2}$/.test(v)
        ) {
          const [y, m, d] = v.split("-").map(Number);
          row.push({
            value: new Date(Date.UTC(y, m - 1, d)),
            type: Date,
            format: "dd-mmm-yyyy",
          });
        } else if (
          (f.type === "money" || f.type === "number") &&
          !Number.isNaN(Number(v))
        )
          row.push({ value: Number(v), type: Number });
        else row.push({ value: String(v) });
      }
      rows.push(row);
    }
  }
  const slug =
    board.propertyName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "beds";
  await writeXlsxFile(rows as never, {
    sheet: "Beds",
    columns: header.map((h, i) => ({
      width: i < 2 ? 7 : Math.max(12, Math.min(30, h.length + 4)),
    })),
  }).toFile(`${slug}-beds-${todayIso()}.xlsx`);
}
