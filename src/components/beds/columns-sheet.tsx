"use client";

import { ArrowDown, ArrowUp, X } from "lucide-react";
import { useState } from "react";
import {
  CORE_FIELDS,
  FIELD_TYPE_LABELS,
  FIELD_TYPES,
  LIMITS,
  SHOW_FOR,
  SHOW_FOR_LABELS,
  showForOf,
  type FieldType,
  type ShowFor,
} from "@convex/lib/bedBoard";
import { newFieldKey, type TableDraft } from "@/components/beds/table-view";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input, inputClasses } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Sheet } from "@/components/ui/sheet";
import { toast } from "@/components/ui/toaster";
import { cn } from "@/lib/utils";

/**
 * The details kept for each tenant: rename, reorder, add, remove, and
 * choose which ones wardens can see. Changes go into the table draft and are
 * saved with it.
 */
export function ColumnsSheet({
  draft,
  setDraft,
  onClose,
}: {
  draft: TableDraft;
  setDraft: (d: TableDraft) => void;
  onClose: () => void;
}) {
  const fields = draft.fields;
  const [confirmRemove, setConfirmRemove] = useState<number | null>(null);
  const [label, setLabel] = useState("");
  const [type, setType] = useState<FieldType>("text");
  const [showFor, setShowFor] = useState<ShowFor>("all");
  const [options, setOptions] = useState("");
  const [warden, setWarden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setFields = (next: typeof fields) =>
    setDraft({ ...draft, fields: next });
  const patch = (i: number, p: Partial<(typeof fields)[number]>) =>
    setFields(fields.map((f, j) => (j === i ? { ...f, ...p } : f)));
  const usedBy = (k: string) =>
    Object.values(draft.beds).filter(
      (b) => b.status !== "vacant" && (b.tenant[k] ?? "").trim() !== "",
    ).length;
  const remove = (i: number) => {
    const k = fields[i].k;
    const beds = Object.fromEntries(
      Object.entries(draft.beds).map(([id, b]) => {
        const tenant = { ...b.tenant };
        delete tenant[k];
        return [id, { ...b, tenant }];
      }),
    );
    setDraft({ ...draft, fields: fields.filter((_, j) => j !== i), beds });
    setConfirmRemove(null);
    toast("Column removed. Save the table to keep this change.");
  };
  const move = (i: number, by: -1 | 1) => {
    const next = [...fields];
    [next[i], next[i + by]] = [next[i + by], next[i]];
    setFields(next);
  };
  const add = () => {
    const name = label.trim();
    if (!name) return setError("Give the column a name.");
    if (name.length > LIMITS.label)
      return setError(`At most ${LIMITS.label} characters.`);
    if (fields.length >= LIMITS.fields)
      return setError(`At most ${LIMITS.fields} columns.`);
    const choices = options
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    if (type === "select" && choices.length === 0)
      return setError("Add at least one choice.");
    setFields([
      ...fields,
      {
        k: newFieldKey(),
        label: name,
        type,
        on: [...SHOW_FOR[showFor]],
        options: type === "select" ? choices : undefined,
        warden,
      },
    ]);
    setLabel("");
    setType("text");
    setShowFor("all");
    setOptions("");
    setWarden(false);
    setError(null);
    toast(`${name} added. Save the table to keep it.`);
  };

  return (
    <Sheet
      open
      onOpenChange={(open) => !open && onClose()}
      title="Columns"
      description="Rename, reorder, add or remove the details you keep for each tenant, and choose what wardens can see. Saved with the table."
      footer={
        <Button variant="secondary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <ol className="flex flex-col gap-3">
        {fields.map((f, i) => {
          const core = CORE_FIELDS[f.k];
          return (
            <li
              key={f.k}
              className="flex flex-col gap-2 rounded-md border border-border bg-subtle p-3"
            >
              <div className="flex items-center gap-1.5">
                <label htmlFor={`col-${f.k}`} className="sr-only">
                  Column name
                </label>
                <input
                  id={`col-${f.k}`}
                  className={cn(inputClasses, "h-9 font-medium")}
                  value={f.label}
                  maxLength={LIMITS.label}
                  onChange={(e) => patch(i, { label: e.target.value })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${f.label} up`}
                  disabled={i === 0}
                  onClick={() => move(i, -1)}
                >
                  <Icon icon={ArrowUp} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Move ${f.label} down`}
                  disabled={i === fields.length - 1}
                  onClick={() => move(i, 1)}
                >
                  <Icon icon={ArrowDown} />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label={`Remove ${f.label}`}
                  disabled={!!core}
                  title={core ? "Needed for bookings" : undefined}
                  onClick={() =>
                    usedBy(f.k) > 0 ? setConfirmRemove(i) : remove(i)
                  }
                >
                  <Icon icon={X} />
                </Button>
              </div>
              {core ? (
                <p className="text-xs text-foreground-secondary">
                  {FIELD_TYPE_LABELS[f.type]}. Needed for bookings, so it can be
                  renamed but not removed. Wardens can see it.
                </p>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label htmlFor={`col-type-${f.k}`} className="sr-only">
                        Type of {f.label}
                      </label>
                      <NativeSelect
                        id={`col-type-${f.k}`}
                        className="h-9 text-sm"
                        value={f.type}
                        onChange={(e) => {
                          const t = e.target.value as FieldType;
                          patch(i, {
                            type: t,
                            options:
                              t === "select" ? (f.options ?? []) : undefined,
                          });
                        }}
                      >
                        {FIELD_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {FIELD_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                    <div>
                      <label htmlFor={`col-for-${f.k}`} className="sr-only">
                        Who {f.label} is for
                      </label>
                      <NativeSelect
                        id={`col-for-${f.k}`}
                        className="h-9 text-sm"
                        value={showForOf(f.on)}
                        onChange={(e) =>
                          patch(i, {
                            on: [...SHOW_FOR[e.target.value as ShowFor]],
                          })
                        }
                      >
                        {(Object.keys(SHOW_FOR) as ShowFor[]).map((s) => (
                          <option key={s} value={s}>
                            For {SHOW_FOR_LABELS[s].toLowerCase()}
                          </option>
                        ))}
                      </NativeSelect>
                    </div>
                  </div>
                  {f.type === "select" ? (
                    <>
                      <label htmlFor={`col-opts-${f.k}`} className="sr-only">
                        Choices for {f.label}
                      </label>
                      <input
                        id={`col-opts-${f.k}`}
                        className={cn(inputClasses, "h-9 text-sm")}
                        placeholder="Choices, separated by commas"
                        defaultValue={(f.options ?? []).join(", ")}
                        onBlur={(e) =>
                          patch(i, {
                            options: e.target.value
                              .split(",")
                              .map((x) => x.trim())
                              .filter(Boolean),
                          })
                        }
                      />
                    </>
                  ) : null}
                  <WardenToggle
                    id={`col-warden-${f.k}`}
                    checked={f.warden}
                    onChange={(v) => patch(i, { warden: v })}
                  />
                </>
              )}
              {confirmRemove === i ? (
                <div
                  role="alert"
                  className="flex flex-col gap-2 rounded-sm border border-danger-border bg-danger-subtle p-3 text-sm"
                >
                  <p>
                    Remove {f.label}? This deletes it for {usedBy(f.k)}{" "}
                    {usedBy(f.k) === 1 ? "tenant" : "tenants"} when you save the
                    table.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button variant="destructive" onClick={() => remove(i)}>
                      Remove column
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => setConfirmRemove(null)}
                    >
                      Keep it
                    </Button>
                  </div>
                </div>
              ) : null}
            </li>
          );
        })}
      </ol>

      <div className="mt-6 flex flex-col gap-4">
        <h3 className="font-semibold">Add a column</h3>
        <Field id="new-col-label" label="Column name">
          {(p) => (
            <Input
              {...p}
              value={label}
              maxLength={LIMITS.label}
              placeholder="For example, Food preference"
              onChange={(e) => setLabel(e.target.value)}
            />
          )}
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field id="new-col-type" label="Type">
            {(p) => (
              <NativeSelect
                {...p}
                value={type}
                onChange={(e) => setType(e.target.value as FieldType)}
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {FIELD_TYPE_LABELS[t]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
          <Field id="new-col-for" label="Used for">
            {(p) => (
              <NativeSelect
                {...p}
                value={showFor}
                onChange={(e) => setShowFor(e.target.value as ShowFor)}
              >
                {(Object.keys(SHOW_FOR) as ShowFor[]).map((s) => (
                  <option key={s} value={s}>
                    {SHOW_FOR_LABELS[s]}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        </div>
        {type === "select" ? (
          <Field id="new-col-options" label="Choices, separated by commas">
            {(p) => (
              <Input
                {...p}
                value={options}
                placeholder="Veg, Non-veg, Jain"
                onChange={(e) => setOptions(e.target.value)}
              />
            )}
          </Field>
        ) : null}
        <WardenToggle
          id="new-col-warden"
          checked={warden}
          onChange={setWarden}
        />
        {error ? <Banner tone="danger">{error}</Banner> : null}
        <div>
          <Button onClick={add}>Add column</Button>
        </div>
      </div>
    </Sheet>
  );
}

function WardenToggle({
  id,
  checked,
  onChange,
}: {
  id: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-sm">
      <input
        id={id}
        type="checkbox"
        className="size-4 accent-[var(--color-primary)]"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      Wardens can see this
    </label>
  );
}
