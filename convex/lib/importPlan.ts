import type { ProfileType } from "./validators";

/**
 * The one-time import of people and properties that already exist in the
 * tools. Pure functions (no database), so they're easy to test; the import
 * itself is convex/importer.ts.
 *
 * Each tool's /sso/export answers with ToolExport. People are matched across
 * tools by phone number; properties by the hub id a tool already stores, or
 * else by name (case and spaces ignored). The admin reviews the plan and can
 * change each property's target and each clashing person's type.
 */

export type ExportedProperty = { toolPropertyId: string; name: string; hubPropertyId?: string | null };
export type ExportedPerson = {
  phone: string;
  name: string;
  /** The tool's role, already turned into a hub profile type by the tool. */
  hubType: ProfileType;
  toolPropertyIds: string[];
  active: boolean;
  /** The tool's password hash (Scrypt, the same as the hub's). Never shown or stored except as the hub password. */
  passwordHash?: string | null;
  roomNumber?: string | null;
};
export type ToolExport = { toolId: string; properties: ExportedProperty[]; people: ExportedPerson[] };

export type HubState = {
  properties: { id: string; name: string }[];
  people: { phone: string; userId: string; type: ProfileType }[];
};

export type PlannedProperty = {
  key: string;
  name: string;
  /** The hub property it matches now, or null = a new one would be made. */
  hubPropertyId: string | null;
  tools: { toolId: string; toolPropertyId: string; name: string }[];
};

export type PlannedPerson = {
  phone: string;
  name: string;
  /** Strongest type found, or the hub's own when they're already in the hub. */
  type: ProfileType;
  byTool: { toolId: string; type: ProfileType }[];
  propertyKeys: string[];
  alreadyInHub: boolean;
  /** Different types in different tools (other than admin) - the admin should choose. */
  clash: boolean;
  hasPassword: boolean;
  roomNumber: string | null;
};

const RANK: Record<ProfileType, number> = { admin: 4, warden: 3, staff: 2, resident: 1 };

export const nameKey = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");

export function buildPlan(exports: ToolExport[], hub: HubState) {
  const hubById = new Map(hub.properties.map((p) => [p.id, p]));
  const hubByName = new Map(hub.properties.map((p) => [nameKey(p.name), p]));

  // Properties: group the tools' rows.
  const groups = new Map<string, PlannedProperty>();
  const keyOfToolProperty = new Map<string, string>(); // `${toolId}:${toolPropertyId}` -> group key
  for (const ex of exports) {
    for (const row of ex.properties) {
      const linked = row.hubPropertyId ? hubById.get(row.hubPropertyId) : undefined;
      const key = linked ? `hub:${linked.id}` : `name:${nameKey(row.name)}`;
      let group = groups.get(key);
      if (group === undefined) {
        const match = linked ?? hubByName.get(nameKey(row.name));
        group = { key, name: match?.name ?? row.name.trim(), hubPropertyId: match?.id ?? null, tools: [] };
        groups.set(key, group);
      }
      group.tools.push({ toolId: ex.toolId, toolPropertyId: row.toolPropertyId, name: row.name });
      keyOfToolProperty.set(`${ex.toolId}:${row.toolPropertyId}`, key);
    }
  }

  // People: one per phone, active ones only.
  const hubPeople = new Map(hub.people.map((p) => [p.phone, p]));
  const people = new Map<string, PlannedPerson>();
  for (const ex of exports) {
    for (const person of ex.people) {
      if (!person.active) continue;
      let planned = people.get(person.phone);
      if (planned === undefined) {
        const inHub = hubPeople.get(person.phone);
        planned = {
          phone: person.phone,
          name: person.name.trim(),
          type: inHub?.type ?? person.hubType,
          byTool: [],
          propertyKeys: [],
          alreadyInHub: inHub !== undefined,
          clash: false,
          hasPassword: false,
          roomNumber: null,
        };
        people.set(person.phone, planned);
      }
      planned.byTool.push({ toolId: ex.toolId, type: person.hubType });
      if (!planned.alreadyInHub && RANK[person.hubType] > RANK[planned.type]) planned.type = person.hubType;
      if (person.passwordHash) planned.hasPassword = true;
      if (planned.roomNumber === null && person.roomNumber) planned.roomNumber = person.roomNumber;
      for (const id of person.toolPropertyIds) {
        const key = keyOfToolProperty.get(`${ex.toolId}:${id}`);
        if (key && !planned.propertyKeys.includes(key)) planned.propertyKeys.push(key);
      }
    }
  }
  for (const planned of people.values()) {
    const types = new Set(planned.byTool.map((b) => b.type).filter((t) => t !== "admin"));
    planned.clash = !planned.alreadyInHub && types.size > 1;
  }

  return {
    properties: [...groups.values()].sort((a, b) => a.name.localeCompare(b.name)),
    people: [...people.values()].sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** The password hash to keep for a phone: the first tool in hub order that has one. */
export function passwordHashFor(exports: ToolExport[], phone: string): string | null {
  for (const ex of exports) {
    const hash = ex.people.find((p) => p.phone === phone && p.active && p.passwordHash)?.passwordHash;
    if (hash) return hash;
  }
  return null;
}

export type Plan = ReturnType<typeof buildPlan>;
