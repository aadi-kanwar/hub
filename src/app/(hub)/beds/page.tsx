"use client";

import { useMutation } from "convex/react";
import { BedDouble, LayoutTemplate, SquareDashed } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { STARTER_LAYOUT } from "@convex/lib/bedBoard";
import { useMe } from "@/components/app/session";
import { BedBoard } from "@/components/beds/board";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState, NotAuthorizedState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

const REMEMBER = "hub-beds-property";

/** The bed board. Admins: every property, editable. Wardens/managers: their own, view-only. */
export default function BedsPage() {
  const me = useMe();
  if (me === undefined || me === null) return <LoadingState />;
  if (me.profileType !== "admin" && me.profileType !== "warden") {
    return (
      <NotAuthorizedState description="The bed board is for admins and wardens." />
    );
  }
  return <Beds />;
}

function Beds() {
  const places = useQuery(api.bedBoard.places, {});
  // The property chosen last time on this device (the board loads after this, so no flash).
  const [chosen, setChosen] = useState<Id<"properties"> | null>(() => {
    try {
      return typeof window === "undefined"
        ? null
        : (localStorage.getItem(REMEMBER) as Id<"properties"> | null);
    } catch {
      return null;
    }
  });

  if (places === undefined) return <LoadingState />;
  const properties = places.properties;
  if (properties.length === 0) {
    return (
      <>
        <PageHeader title="Beds" />
        <EmptyState
          icon={BedDouble}
          title="No properties yet"
          description={
            places.canEdit
              ? "Add a property on the Properties page first."
              : "You aren't assigned to a property yet. Ask your PG's admin."
          }
        />
      </>
    );
  }
  const current =
    properties.find((p) => p.propertyId === chosen) ?? properties[0];
  const choose = (id: Id<"properties">) => {
    setChosen(id);
    try {
      localStorage.setItem(REMEMBER, id);
    } catch {
      // Not remembered; fine.
    }
  };

  return (
    <>
      <PageHeader
        title="Beds"
        description={
          places.canEdit
            ? "Who is in each bed, who is booked and who is leaving."
            : "Who is in each bed. View only."
        }
        actions={
          properties.length > 1 ? (
            <div className="w-full sm:w-64">
              <label htmlFor="beds-property" className="sr-only">
                Property
              </label>
              <NativeSelect
                id="beds-property"
                value={current.propertyId}
                onChange={(e) => choose(e.target.value as Id<"properties">)}
              >
                {properties.map((p) => (
                  <option key={p.propertyId} value={p.propertyId}>
                    {p.name}
                  </option>
                ))}
              </NativeSelect>
            </div>
          ) : null
        }
      />
      {current.hasBoard ? (
        <BedBoard key={current.propertyId} propertyId={current.propertyId} />
      ) : places.canEdit ? (
        <SetUp propertyId={current.propertyId} name={current.name} />
      ) : (
        <EmptyState
          icon={BedDouble}
          title="Not set up yet"
          description={`${current.name}'s bed board hasn't been set up yet.`}
        />
      )}
    </>
  );
}

function SetUp({
  propertyId,
  name,
}: {
  propertyId: Id<"properties">;
  name: string;
}) {
  const create = useMutation(api.bedBoard.create);
  const [busy, setBusy] = useState<"starter" | "empty" | null>(null);
  const start = async (kind: "starter" | "empty") => {
    setBusy(kind);
    try {
      await create({ propertyId, start: kind });
      toast.success(`${name}'s bed board is ready.`);
    } catch (error) {
      toast.error(friendlyError(error));
    } finally {
      setBusy(null);
    }
  };
  const beds = STARTER_LAYOUT.rooms.reduce((n, r) => n + r.type, 0);
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-foreground-secondary">
        {name} doesn&apos;t have a bed board yet. Choose how to start; you can
        change floors and rooms any time with Edit layout.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardBody className="flex h-full flex-col gap-3">
            <Icon icon={LayoutTemplate} className="text-primary-text" />
            <p className="font-medium">
              Use the earlier bed board&apos;s rooms
            </p>
            <p className="flex-1 text-sm text-foreground-secondary">
              Floors 2 to 5: {STARTER_LAYOUT.rooms.length} rooms, {beds} beds,
              every bed vacant.
            </p>
            <Button
              loading={busy === "starter"}
              disabled={busy !== null}
              onClick={() => start("starter")}
            >
              Start with these rooms
            </Button>
          </CardBody>
        </Card>
        <Card>
          <CardBody className="flex h-full flex-col gap-3">
            <Icon icon={SquareDashed} className="text-primary-text" />
            <p className="font-medium">Start empty</p>
            <p className="flex-1 text-sm text-foreground-secondary">
              One floor and no rooms. Add them yourself.
            </p>
            <Button
              variant="secondary"
              loading={busy === "empty"}
              disabled={busy !== null}
              onClick={() => start("empty")}
            >
              Start empty
            </Button>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
