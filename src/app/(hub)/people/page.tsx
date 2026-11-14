"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { CircleCheck, CircleSlash, KeyRound, Pencil, RefreshCw, UserPlus, UserX } from "lucide-react";
import { useMemo, useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  PASSWORD_MIN_LENGTH,
  displayNameSchema,
  formatPhoneForDisplay,
  normalizePhone,
  passwordProblem,
  roomNumberSchema,
} from "@convex/lib/inputRules";
import { PROFILE_TYPE_LABELS } from "@convex/lib/profiles";
import { PROFILE_TYPES, type ProfileType } from "@convex/lib/validators";
import { PropertyPicker, propertyError, type PropertyOption } from "@/components/app/property-picker";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { FilterBar, SearchInput } from "@/components/ui/filter-bar";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

type Person = FunctionReturnType<typeof api.people.list>[number];

// Letters and digits that are hard to confuse when read out (no 0/o, 1/l/i).
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A suggestion such as "kq7m-p3rx-w8tn"; the admin can type their own instead. */
function suggestPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

/** Everyone: add, change type and properties, move, reset password, deactivate. */
export default function PeoplePage() {
  const people = useQuery(api.people.list, {});
  const options = useQuery(api.properties.options, {});
  const [type, setType] = useState<ProfileType | "all">("all");
  const [search, setSearch] = useState("");
  const shown = useMemo(() => {
    const term = search.trim().toLowerCase();
    return (people ?? []).filter(
      (p) =>
        (type === "all" || p.profileType === type) &&
        (term === "" || p.name.toLowerCase().includes(term) || p.phone.includes(term.replace(/\s/g, ""))),
    );
  }, [people, type, search]);

  return (
    <>
      <PageHeader
        title="People"
        description="Everyone who signs in through the hub. Residents can sign up with a join code; add wardens, managers and staff here."
        actions={options ? <AddPersonButton options={options} /> : null}
      />
      <FilterBar>
        <SearchInput label="Search by name or number" placeholder="Search name or number" value={search} onChange={(e) => setSearch(e.target.value)} />
        <NativeSelect aria-label="Profile type" value={type} onChange={(e) => setType(e.target.value as ProfileType | "all")} className="sm:w-56">
          <option value="all">All profile types</option>
          {PROFILE_TYPES.map((t) => (
            <option key={t} value={t}>
              {PROFILE_TYPE_LABELS[t]}
            </option>
          ))}
        </NativeSelect>
      </FilterBar>
      {people === undefined || options === undefined ? (
        <LoadingState />
      ) : shown.length === 0 ? (
        <EmptyState title="No one here" description="No profiles match these filters." />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Type</TH>
                <TH>Properties</TH>
                <TH>Mobile number</TH>
                <TH>Status</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {shown.map((person) => (
                <TR key={person.userId}>
                  <TD className="font-medium">
                    {person.name}
                    {person.isYou ? <span className="font-normal text-foreground-secondary"> (you)</span> : null}
                    {person.roomNumber ? (
                      <span className="block text-xs font-normal text-foreground-secondary">Room {person.roomNumber}</span>
                    ) : null}
                  </TD>
                  <TD className="whitespace-nowrap">{PROFILE_TYPE_LABELS[person.profileType]}</TD>
                  <TD>{person.profileType === "admin" ? "All" : person.propertyNames.join(", ") || "—"}</TD>
                  <TD className="whitespace-nowrap">{formatPhoneForDisplay(person.phone)}</TD>
                  <TD>
                    <div className="flex flex-col items-start gap-1">
                      <PersonStatus person={person} />
                      {person.syncWaiting.some((j) => j.failing) ? (
                        <StatusBadge tone="warning" icon={RefreshCw}>
                          Not in all tools yet
                        </StatusBadge>
                      ) : null}
                    </div>
                  </TD>
                  <TD>
                    {person.status === "active" && !person.isYou ? (
                      <div className="flex justify-end gap-2">
                        <EditPersonButton person={person} options={options} />
                        <ResetPasswordButton person={person} />
                        <DeactivateButton person={person} />
                      </div>
                    ) : person.status === "active" ? (
                      <div className="flex justify-end">
                        <EditPersonButton person={person} options={options} />
                      </div>
                    ) : null}
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      <p className="text-sm text-foreground-secondary">
        To switch a deactivated person back on, add their number again with a new temporary password. Changing someone’s
        type or properties, or deactivating them, signs them out of the tools at once.
      </p>
    </>
  );
}

function PersonStatus({ person }: { person: Person }) {
  if (person.status !== "active") {
    return (
      <StatusBadge tone="neutral" icon={CircleSlash}>
        Deactivated
      </StatusBadge>
    );
  }
  if (person.mustChangePassword) {
    return (
      <StatusBadge tone="warning" icon={KeyRound}>
        Temporary password
      </StatusBadge>
    );
  }
  return (
    <StatusBadge tone="success" icon={CircleCheck}>
      Active
    </StatusBadge>
  );
}

type Draft = {
  name: string;
  phone: string;
  profileType: ProfileType;
  propertyIds: Id<"properties">[];
  roomNumber: string;
  temporaryPassword: string;
};

type Errors = Partial<Record<keyof Draft, string>>;

function checkDraft(draft: Draft, { isNew }: { isNew: boolean }): Errors {
  const errors: Errors = {};
  if (isNew) {
    const name = displayNameSchema.safeParse(draft.name);
    if (!name.success) errors.name = name.error.issues[0]?.message;
    const phone = normalizePhone(draft.phone);
    if (phone === null) errors.phone = "Enter a valid mobile number.";
    const problem = passwordProblem(draft.temporaryPassword, phone);
    if (problem) errors.temporaryPassword = problem;
  }
  const propertiesProblem = propertyError(draft.profileType, draft.propertyIds.length);
  if (propertiesProblem) errors.propertyIds = propertiesProblem;
  if (draft.profileType === "resident" && draft.roomNumber.trim() !== "") {
    const room = roomNumberSchema.safeParse(draft.roomNumber);
    if (!room.success) errors.roomNumber = room.error.issues[0]?.message;
  }
  return errors;
}

/** Fields shared by Add and Edit. */
function TypeAndProperties({
  idPrefix,
  draft,
  setDraft,
  errors,
  options,
}: {
  idPrefix: string;
  draft: Draft;
  setDraft: (d: Draft) => void;
  errors: Errors;
  options: PropertyOption[];
}) {
  return (
    <>
      <Field id={`${idPrefix}-type`} label="Profile type">
        {(p) => (
          <NativeSelect
            {...p}
            value={draft.profileType}
            onChange={(e) => {
              const profileType = e.target.value as ProfileType;
              const propertyIds =
                profileType === "admin" ? [] : profileType === "resident" ? draft.propertyIds.slice(0, 1) : draft.propertyIds;
              setDraft({ ...draft, profileType, propertyIds });
            }}
          >
            {PROFILE_TYPES.map((t) => (
              <option key={t} value={t}>
                {PROFILE_TYPE_LABELS[t]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      <PropertyPicker
        idPrefix={idPrefix}
        type={draft.profileType}
        options={options}
        value={draft.propertyIds}
        onChange={(propertyIds) => setDraft({ ...draft, propertyIds })}
        error={errors.propertyIds}
      />
      {draft.profileType === "resident" ? (
        <Field id={`${idPrefix}-room`} label="Room number (optional)" error={errors.roomNumber}>
          {(p) => <Input {...p} value={draft.roomNumber} onChange={(e) => setDraft({ ...draft, roomNumber: e.target.value })} />}
        </Field>
      ) : null}
    </>
  );
}

function AddPersonButton({ options }: { options: PropertyOption[] }) {
  const [open, setOpen] = useState(false);
  const create = useAction(api.people.create);
  const blank: Draft = { name: "", phone: "", profileType: "warden", propertyIds: [], roomNumber: "", temporaryPassword: "" };
  const [draft, setDraft] = useState<Draft>(blank);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setServerError(null);
          setErrors({});
          setDraft({ ...blank, temporaryPassword: suggestPassword() });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Icon icon={UserPlus} />
          Add person
        </Button>
      </DialogTrigger>
      <DialogContent title="Add person" description="They sign in with this number and the temporary password, then must choose their own.">
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const found = checkDraft(draft, { isNew: true });
            setErrors(found);
            if (Object.keys(found).length > 0) return;
            setServerError(null);
            setBusy(true);
            try {
              const { reactivated } = await create({
                name: draft.name,
                phone: draft.phone,
                profileType: draft.profileType,
                propertyIds: draft.propertyIds,
                roomNumber: draft.roomNumber || undefined,
                temporaryPassword: draft.temporaryPassword,
              });
              toast.success(
                `${draft.name} ${reactivated ? "is switched back on" : "is added"}. Tell them their temporary password in person.`,
              );
              setOpen(false);
            } catch (error) {
              setServerError(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <Field id="add-name" label="Full name" error={errors.name}>
            {(p) => <Input {...p} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} autoComplete="off" />}
          </Field>
          <Field id="add-phone" label="Mobile number" hint="India (+91) unless you type another country code." error={errors.phone}>
            {(p) => (
              <Input
                {...p}
                value={draft.phone}
                onChange={(e) => setDraft({ ...draft, phone: e.target.value })}
                type="tel"
                inputMode="tel"
                placeholder="98765 43210"
                autoComplete="off"
              />
            )}
          </Field>
          <TypeAndProperties idPrefix="add" draft={draft} setDraft={setDraft} errors={errors} options={options} />
          <Field
            id="add-password"
            label="Temporary password"
            hint={`We suggested one; you can type your own (at least ${PASSWORD_MIN_LENGTH} characters).`}
            error={errors.temporaryPassword}
          >
            {(p) => (
              <Input
                {...p}
                value={draft.temporaryPassword}
                onChange={(e) => setDraft({ ...draft, temporaryPassword: e.target.value })}
                autoComplete="off"
                className="font-mono"
              />
            )}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EditPersonButton({ person, options }: { person: Person; options: PropertyOption[] }) {
  const [open, setOpen] = useState(false);
  const update = useMutation(api.people.update);
  const start = (): Draft => ({
    name: person.name,
    phone: person.phone,
    profileType: person.profileType,
    propertyIds: person.propertyIds,
    roomNumber: person.roomNumber ?? "",
    temporaryPassword: "",
  });
  const [draft, setDraft] = useState<Draft>(start);
  const [errors, setErrors] = useState<Errors>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setServerError(null);
          setErrors({});
          setDraft(start());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={Pencil} />
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Edit ${person.name}`}
        description="Change their profile type or properties, or move a resident to another PG. They're signed out of the tools so their next Open uses the new access."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const found = checkDraft(draft, { isNew: false });
            setErrors(found);
            if (Object.keys(found).length > 0) return;
            setServerError(null);
            setBusy(true);
            try {
              await update({
                userId: person.userId,
                profileType: draft.profileType,
                propertyIds: draft.propertyIds,
                roomNumber: draft.roomNumber || undefined,
              });
              toast.success(`${person.name} is updated.`);
              setOpen(false);
            } catch (error) {
              setServerError(friendlyError(error));
            } finally {
              setBusy(false);
            }
          }}
        >
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          {person.isYou ? <Banner tone="info">You can’t change your own profile type.</Banner> : null}
          <TypeAndProperties idPrefix={`edit-${person.userId}`} draft={draft} setDraft={setDraft} errors={errors} options={options} />
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordButton({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  const reset = useAction(api.people.resetPassword);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
          setPassword(suggestPassword());
        }
      }}
    >
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={KeyRound} />
          Reset password
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Reset ${person.name}'s password`}
        description="They're signed out of the hub and the tools, and must choose a new password at their next sign-in."
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const problem = passwordProblem(password, person.phone);
            if (problem) {
              setError(problem);
              return;
            }
            setBusy(true);
            try {
              await reset({ userId: person.userId, temporaryPassword: password });
              toast.success(`${person.name}'s password is reset. Tell them the temporary password in person.`);
              setOpen(false);
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          <Field id={`reset-${person.userId}`} label="Temporary password" error={error ?? undefined}>
            {(p) => <Input {...p} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" className="font-mono" />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateButton({ person }: { person: Person }) {
  const [open, setOpen] = useState(false);
  const deactivate = useAction(api.people.deactivate);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={UserX} />
          Deactivate
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`Deactivate ${person.name}?`}
        description="They're signed out of the hub and every tool at once, and can't sign in. Their history in the tools is kept."
      >
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            variant="destructive"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await deactivate({ userId: person.userId });
                toast.success(`${person.name} is deactivated.`);
                setOpen(false);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
