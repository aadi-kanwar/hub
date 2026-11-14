"use client";

import { useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { Building2, Copy, Pencil, Plus, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { propertyNameSchema } from "@convex/lib/inputRules";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogClose, DialogContent, DialogFooter, DialogTrigger } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";
import { formatDate } from "@/lib/format";

type Property = FunctionReturnType<typeof api.properties.list>[number];

/** Properties (PGs) and their join codes. New properties are sent to every tool. */
export default function PropertiesPage() {
  const properties = useQuery(api.properties.list, {});
  return (
    <>
      <PageHeader
        title="Properties"
        description="Residents sign up with a property’s join code. It stays the same until you change it."
        actions={<NameDialog mode="add" />}
      />
      {properties === undefined ? (
        <LoadingState />
      ) : properties.length === 0 ? (
        <EmptyState icon={Building2} title="No properties yet" description="Add your first PG, or import them from the tools." />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>Property</TH>
                <TH>Join code</TH>
                <TH>People</TH>
                <TH>
                  <span className="sr-only">Actions</span>
                </TH>
              </TR>
            </THead>
            <TBody>
              {properties.map((property) => (
                <TR key={property.propertyId}>
                  <TD className="font-medium">{property.name}</TD>
                  <TD>
                    <span className="font-mono text-base tracking-widest">{property.joinCode}</span>
                    <span className="block text-xs text-foreground-secondary">since {formatDate(property.joinCodeUpdatedAt)}</span>
                  </TD>
                  <TD>{property.memberCount}</TD>
                  <TD>
                    <div className="flex justify-end gap-2">
                      <Button
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(property.joinCode);
                            toast.success("Join code copied.");
                          } catch {
                            toast.error("Couldn't copy. Please copy it by hand.");
                          }
                        }}
                      >
                        <Icon icon={Copy} />
                        Copy code
                      </Button>
                      <ChangeCodeButton property={property} />
                      <NameDialog mode="rename" property={property} />
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
    </>
  );
}

function NameDialog({ mode, property }: { mode: "add" | "rename"; property?: Property }) {
  const [open, setOpen] = useState(false);
  const create = useMutation(api.properties.create);
  const rename = useMutation(api.properties.rename);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) {
          setError(null);
          setName(property?.name ?? "");
        }
      }}
    >
      <DialogTrigger asChild>
        {mode === "add" ? (
          <Button>
            <Icon icon={Plus} />
            Add property
          </Button>
        ) : (
          <Button variant="secondary">
            <Icon icon={Pencil} />
            Rename
          </Button>
        )}
      </DialogTrigger>
      <DialogContent
        title={mode === "add" ? "Add property" : `Rename ${property?.name}`}
        description={mode === "add" ? "It gets a join code at once, and is added to every tool." : "The new name is sent to every tool."}
      >
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={async (e) => {
            e.preventDefault();
            const parsed = propertyNameSchema.safeParse(name);
            if (!parsed.success) {
              setError(parsed.error.issues[0]?.message ?? "Enter a name.");
              return;
            }
            setBusy(true);
            try {
              if (mode === "add") await create({ name: parsed.data });
              else await rename({ propertyId: property!.propertyId, name: parsed.data });
              toast.success(mode === "add" ? `${parsed.data} is added.` : "Renamed.");
              setOpen(false);
            } catch (err) {
              setError(friendlyError(err));
            } finally {
              setBusy(false);
            }
          }}
        >
          {error ? <Banner tone="danger">{error}</Banner> : null}
          <Field id={`property-name-${property?.propertyId ?? "new"}`} label="Name">
            {(p) => <Input {...p} value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />}
          </Field>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" loading={busy}>
              {mode === "add" ? "Add" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ChangeCodeButton({ property }: { property: Property }) {
  const [open, setOpen] = useState(false);
  const change = useMutation(api.properties.changeJoinCode);
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="secondary">
          <Icon icon={RefreshCw} />
          New code
        </Button>
      </DialogTrigger>
      <DialogContent
        title={`New join code for ${property.name}?`}
        description="The old code stops working at once. People who already joined stay. Share the new code with new residents."
      >
        <DialogFooter>
          <DialogClose asChild>
            <Button variant="secondary">Cancel</Button>
          </DialogClose>
          <Button
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                const code = await change({ propertyId: property.propertyId });
                toast.success(`The new code is ${code}.`);
                setOpen(false);
              } catch (error) {
                toast.error(friendlyError(error));
              } finally {
                setBusy(false);
              }
            }}
          >
            Make new code
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
