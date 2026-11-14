"use client";

import type { Id } from "@convex/_generated/dataModel";
import type { ProfileType } from "@convex/lib/validators";

export type PropertyOption = { propertyId: Id<"properties">; name: string };

/**
 * Which properties a person belongs to. Residents pick one (radio buttons);
 * wardens/managers and staff one or more (checkboxes); admins none - they
 * cover every property.
 */
export function PropertyPicker({
  idPrefix,
  type,
  options,
  value,
  onChange,
  error,
}: {
  idPrefix: string;
  type: ProfileType;
  options: PropertyOption[];
  value: Id<"properties">[];
  onChange: (next: Id<"properties">[]) => void;
  error?: string;
}) {
  if (type === "admin") {
    return <p className="text-sm text-foreground-secondary">Admins cover every property.</p>;
  }
  const single = type === "resident";
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1.5 text-sm font-medium text-foreground">{single ? "Property" : "Properties"}</legend>
      {options.length === 0 ? (
        <p className="text-sm text-foreground-secondary">Add a property first (Properties page).</p>
      ) : (
        options.map((option) => {
          const id = `${idPrefix}-${option.propertyId}`;
          const checked = value.includes(option.propertyId);
          return (
            <label key={option.propertyId} htmlFor={id} className="flex items-center gap-2 text-sm">
              <input
                id={id}
                type={single ? "radio" : "checkbox"}
                name={`${idPrefix}-properties`}
                className="size-4 accent-[var(--color-primary)]"
                checked={checked}
                onChange={(e) => {
                  if (single) onChange([option.propertyId]);
                  else if (e.target.checked) onChange([...value, option.propertyId]);
                  else onChange(value.filter((v) => v !== option.propertyId));
                }}
              />
              {option.name}
            </label>
          );
        })
      )}
      {error ? (
        <p className="text-sm text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </fieldset>
  );
}

/** The same rule the backend applies (lib/profiles.ts), for quicker feedback. */
export function propertyError(type: ProfileType, count: number): string | undefined {
  if (type === "admin") return undefined;
  if (type === "resident") return count === 1 ? undefined : "Choose the resident's property.";
  return count >= 1 ? undefined : "Choose at least one property.";
}
