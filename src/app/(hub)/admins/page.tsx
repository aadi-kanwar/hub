"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useAction } from "convex/react";
import { CircleCheck, CircleSlash, KeyRound, UserPlus, UserX } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import {
  PASSWORD_MIN_LENGTH,
  displayNameSchema,
  formatPhoneForDisplay,
  normalizePhone,
  passwordProblem,
  phoneSchema,
} from "@convex/lib/inputRules";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";

// Letters and digits that are hard to confuse when read out (no 0/o, 1/l/i).
const TEMP_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

/** A suggestion such as "kq7m-p3rx-w8tn"; the admin can type their own instead. */
function suggestPassword(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const chars = [...bytes].map((b) => TEMP_ALPHABET[b % TEMP_ALPHABET.length]);
  return [0, 4, 8].map((i) => chars.slice(i, i + 4).join("")).join("-");
}

function temporaryPasswordRule(phone: string | null) {
  return z.string().superRefine((value, ctx) => {
    const problem = passwordProblem(value, phone);
    if (problem) ctx.addIssue({ code: "custom", message: problem });
  });
}

type AdminRow = {
  userId: Id<"users">;
  name: string;
  phone: string;
  status: "active" | "inactive";
  mustChangePassword: boolean;
  createdAt: number;
  isYou: boolean;
};

/** List, add, deactivate and reset master admins. */
export default function AdminsPage() {
  const admins = useQuery(api.admins.list, {});
  return (
    <>
      <PageHeader
        title="Master admins"
        description="Only master admins can use the hub. This is the only place they’re added or removed."
        actions={<AddAdminButton />}
      />
      {admins === undefined ? (
        <LoadingState />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Name</TH>
                <TH>Mobile number</TH>
                <TH>Status</TH>
                <TH>Added</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {admins.map((admin) => (
                <TR key={admin.userId}>
                  <TD className="font-medium">
                    {admin.name}
                    {admin.isYou ? <span className="font-normal text-foreground-secondary"> (you)</span> : null}
                  </TD>
                  <TD className="whitespace-nowrap">{formatPhoneForDisplay(admin.phone)}</TD>
                  <TD>
                    {admin.status === "active" ? (
                      admin.mustChangePassword ? (
                        <StatusBadge tone="warning" icon={KeyRound}>
                          Temporary password
                        </StatusBadge>
                      ) : (
                        <StatusBadge tone="success" icon={CircleCheck}>
                          Active
                        </StatusBadge>
                      )
                    ) : (
                      <StatusBadge tone="neutral" icon={CircleSlash}>
                        Deactivated
                      </StatusBadge>
                    )}
                  </TD>
                  <TD className="whitespace-nowrap">{formatDate(admin.createdAt)}</TD>
                  <TD>
                    {admin.status === "active" && !admin.isYou ? (
                      <div className="flex justify-end gap-2">
                        <ResetPasswordButton admin={admin} />
                        <DeactivateButton admin={admin} />
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
        To switch a deactivated master admin back on, add their number again with a new temporary password.
      </p>
    </>
  );
}

const addSchema = z
  .object({ name: displayNameSchema, phone: phoneSchema, temporaryPassword: z.string() })
  .superRefine((values, ctx) => {
    const problem = passwordProblem(values.temporaryPassword, normalizePhone(values.phone));
    if (problem) ctx.addIssue({ code: "custom", path: ["temporaryPassword"], message: problem });
  });

function AddAdminButton() {
  const [open, setOpen] = useState(false);
  const create = useAction(api.admins.create);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<z.infer<typeof addSchema>>({
    resolver: zodResolver(addSchema),
    defaultValues: { name: "", phone: "", temporaryPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async (values) => {
    setServerError(null);
    try {
      const { reactivated } = await create(values);
      toast.success(
        `${values.name} ${reactivated ? "is switched back on" : "is added"}. Tell them their temporary password in person.`,
      );
      setOpen(false);
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setServerError(null);
          form.reset({ name: "", phone: "", temporaryPassword: suggestPassword() });
        }
      }}
    >
      <DialogTrigger asChild>
        <Button>
          <Icon icon={UserPlus} />
          Add master admin
        </Button>
      </DialogTrigger>
      <DialogContent
        title="Add master admin"
        description="They sign in with this number and the temporary password, then must choose their own."
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <Field id="name" label="Full name" error={errors.name?.message}>
            {(p) => <Input {...p} {...form.register("name")} autoComplete="off" />}
          </Field>
          <Field id="phone" label="Mobile number" hint="India (+91) unless you type another country code." error={errors.phone?.message}>
            {(p) => <Input {...p} {...form.register("phone")} type="tel" inputMode="tel" placeholder="98765 43210" autoComplete="off" />}
          </Field>
          <Field
            id="temporaryPassword"
            label="Temporary password"
            hint={`We suggested one; you can type your own (at least ${PASSWORD_MIN_LENGTH} characters).`}
            error={errors.temporaryPassword?.message}
          >
            {(p) => <Input {...p} {...form.register("temporaryPassword")} autoComplete="off" className="font-mono" />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={isSubmitting}>
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ResetPasswordButton({ admin }: { admin: AdminRow }) {
  const [open, setOpen] = useState(false);
  const reset = useAction(api.admins.resetPassword);
  const [serverError, setServerError] = useState<string | null>(null);
  const schema = z.object({ temporaryPassword: temporaryPasswordRule(admin.phone) });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { temporaryPassword: "" },
  });
  const { errors, isSubmitting } = form.formState;
  const onSubmit = form.handleSubmit(async ({ temporaryPassword }) => {
    setServerError(null);
    try {
      await reset({ userId: admin.userId, temporaryPassword });
      toast.success(`${admin.name}'s password is reset. Tell them the temporary password in person.`);
      setOpen(false);
    } catch (error) {
      setServerError(friendlyError(error));
    }
  });
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setServerError(null);
          form.reset({ temporaryPassword: suggestPassword() });
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
        title={`Reset ${admin.name}'s password`}
        description="They're signed out of the hub everywhere and must choose a new password at their next sign-in."
      >
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
          {serverError ? <Banner tone="danger">{serverError}</Banner> : null}
          <Field id={`reset-${admin.userId}`} label="Temporary password" error={errors.temporaryPassword?.message}>
            {(p) => <Input {...p} {...form.register("temporaryPassword")} autoComplete="off" className="font-mono" />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={isSubmitting}>
              Reset password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function DeactivateButton({ admin }: { admin: AdminRow }) {
  const [open, setOpen] = useState(false);
  const deactivate = useAction(api.admins.deactivate);
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
        title={`Deactivate ${admin.name}?`}
        description="They're signed out of the hub at once and can't open any tool from it. Tool sessions they already opened end within 12 hours."
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
                await deactivate({ userId: admin.userId });
                toast.success(`${admin.name} is deactivated.`);
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
