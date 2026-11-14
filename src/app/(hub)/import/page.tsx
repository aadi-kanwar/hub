"use client";

import { useAction, useMutation } from "convex/react";
import type { FunctionReturnType } from "convex/server";
import { AlertTriangle, DownloadCloud, RefreshCw } from "lucide-react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import { PROFILE_TYPE_LABELS } from "@convex/lib/profiles";
import { PROFILE_TYPES, type ProfileType } from "@convex/lib/validators";
import { TOOLS } from "@root/tools.config";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

type Plan = FunctionReturnType<typeof api.importer.preview>;

const toolName = (id: string) => TOOLS.find((t) => t.id === id)?.name ?? id;

/**
 * One-time import of people and properties already in the tools. Nothing is
 * saved until "Import". Safe to run again: people already in the hub stay as
 * they are.
 */
export default function ImportPage() {
  const preview = useAction(api.importer.preview);
  const apply = useAction(api.importer.apply);
  const hubProperties = useQuery(api.properties.options, {});
  const [plan, setPlan] = useState<Plan | null>(null);
  const [targets, setTargets] = useState<Record<string, string>>({});
  const [types, setTypes] = useState<Record<string, ProfileType>>({});
  const [busy, setBusy] = useState<"preview" | "apply" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    setBusy("preview");
    setError(null);
    try {
      const next = await preview({});
      setPlan(next);
      setTargets(Object.fromEntries(next.properties.map((p) => [p.key, p.hubPropertyId ?? "new"])));
      setTypes(Object.fromEntries(next.people.map((p) => [p.phone, p.type])));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Import from tools"
        description="Brings the people and properties already in Dine, Staff and Crate into the hub, matched by phone number. Check the plan, then import."
        actions={
          <Button variant={plan ? "secondary" : "primary"} loading={busy === "preview"} onClick={load}>
            {busy === "preview" ? null : <Icon icon={plan ? RefreshCw : DownloadCloud} />}
            {plan ? "Check again" : "Check the tools"}
          </Button>
        }
      />
      {error ? <Banner tone="danger">{error}</Banner> : null}
      <SyncStatus />
      {plan ? (
        <>
          {plan.failed.length > 0 ? (
            <Banner tone="warning">
              {plan.failed.map((f) => `${f.name}: ${f.reason}`).join(" ")} Importing needs every tool to answer.
            </Banner>
          ) : null}

          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-xl tracking-tight">Properties</h2>
            <Card className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Name in the tools</TH>
                    <TH>In the hub</TH>
                  </TR>
                </THead>
                <TBody>
                  {plan.properties.map((p) => (
                    <TR key={p.key}>
                      <TD>
                        <span className="font-medium">{p.name}</span>
                        <span className="block text-xs text-foreground-secondary">
                          {p.tools.map((x) => `${toolName(x.toolId)}: “${x.name}”`).join(" · ")}
                        </span>
                      </TD>
                      <TD>
                        <NativeSelect
                          aria-label={`Hub property for ${p.name}`}
                          value={targets[p.key] ?? "new"}
                          onChange={(e) => setTargets({ ...targets, [p.key]: e.target.value })}
                        >
                          <option value="new">Add as a new property</option>
                          {(hubProperties ?? []).map((h) => (
                            <option key={h.propertyId} value={h.propertyId}>
                              Same as {h.name}
                            </option>
                          ))}
                          <option value="skip">Don’t import</option>
                        </NativeSelect>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          </section>

          <section className="flex flex-col gap-3">
            <h2 className="font-serif text-xl tracking-tight">People ({plan.people.length})</h2>
            {plan.people.some((p) => p.clash) ? (
              <Banner tone="warning">
                Some people have different roles in different tools. Choose one profile type for each.
              </Banner>
            ) : null}
            <Card className="overflow-x-auto">
              <Table>
                <THead>
                  <TR>
                    <TH>Name</TH>
                    <TH>In the tools</TH>
                    <TH>Profile type</TH>
                  </TR>
                </THead>
                <TBody>
                  {plan.people.map((person) => (
                    <TR key={person.phone}>
                      <TD>
                        <span className="font-medium">{person.name}</span>
                        <span className="block text-xs text-foreground-secondary">{formatPhoneForDisplay(person.phone)}</span>
                        {!person.hasPassword && !person.alreadyInHub ? (
                          <span className="block text-xs text-warning">No password in the tools: reset it after importing.</span>
                        ) : null}
                      </TD>
                      <TD className="text-sm">
                        {person.byTool.map((b) => `${toolName(b.toolId)}: ${PROFILE_TYPE_LABELS[b.type]}`).join(" · ")}
                      </TD>
                      <TD>
                        {person.alreadyInHub ? (
                          <span className="text-sm text-foreground-secondary">Already in the hub ({PROFILE_TYPE_LABELS[person.type]})</span>
                        ) : (
                          <div className="flex flex-col gap-1">
                            <NativeSelect
                              aria-label={`Profile type for ${person.name}`}
                              value={types[person.phone] ?? person.type}
                              onChange={(e) => setTypes({ ...types, [person.phone]: e.target.value as ProfileType })}
                            >
                              {PROFILE_TYPES.map((t) => (
                                <option key={t} value={t}>
                                  {PROFILE_TYPE_LABELS[t]}
                                </option>
                              ))}
                            </NativeSelect>
                            {person.clash ? (
                              <StatusBadge tone="warning" icon={AlertTriangle}>
                                Check this one
                              </StatusBadge>
                            ) : null}
                          </div>
                        )}
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          </section>

          <Card>
            <CardBody className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-foreground-secondary">
                People keep their current password. Then every tool is linked to the hub, which can take a minute.
              </p>
              <Button
                loading={busy === "apply"}
                disabled={plan.failed.length > 0}
                onClick={async () => {
                  setBusy("apply");
                  try {
                    const result = await apply({
                      propertyTargets: Object.entries(targets).map(([key, target]) => ({ key, target })),
                      typeChoices: Object.entries(types).map(([phone, type]) => ({ phone, type })),
                    });
                    if (!result.ok) {
                      setError(`${result.failed.map((f) => f.name).join(", ")} didn’t answer. Nothing was imported.`);
                    } else {
                      toast.success(
                        `Imported: ${result.created} people added, ${result.linked} linked, ${result.propertiesCreated} properties added.`,
                      );
                      if (result.needsPassword.length > 0) {
                        toast.error(`Give a temporary password to: ${result.needsPassword.join(", ")}.`);
                      }
                      setPlan(null);
                    }
                  } catch (e) {
                    setError(friendlyError(e));
                  } finally {
                    setBusy(null);
                  }
                }}
              >
                Import
              </Button>
            </CardBody>
          </Card>
        </>
      ) : null}
    </>
  );
}

/** Changes the tools haven't confirmed yet. */
function SyncStatus() {
  const status = useQuery(api.sync.status, {});
  const retry = useMutation(api.sync.retryNow);
  if (!status || status.length === 0) return null;
  const failing = status.filter((s) => s.failing > 0);
  if (failing.length === 0) {
    return <Banner tone="info">Sending {status.reduce((n, s) => n + s.waiting, 0)} changes to the tools…</Banner>;
  }
  return (
    <Banner tone="warning">
      <span className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span>
          {failing.map((s) => `${toolName(s.toolId)} hasn’t confirmed ${s.waiting} changes${s.lastError ? ` (${s.lastError})` : ""}.`).join(" ")}{" "}
          The hub keeps trying.
        </span>
        <Button variant="secondary" onClick={() => retry({}).catch((e: unknown) => toast.error(friendlyError(e)))}>
          Try now
        </Button>
      </span>
    </Banner>
  );
}
