"use client";

import { usePaginatedQuery } from "convex/react";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { Doc } from "@convex/_generated/dataModel";
import { formatPhoneForDisplay } from "@convex/lib/inputRules";
import type { ActivityType } from "@convex/lib/validators";
import { findTool } from "@root/tools.config";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { NativeSelect } from "@/components/ui/native-select";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";

const LABELS: Record<ActivityType, string> = {
  login: "Signed in",
  login_failed: "Failed sign-in",
  tool_launched: "Opened a tool",
  admin_added: "Added a master admin",
  admin_reactivated: "Switched a master admin back on",
  admin_deactivated: "Deactivated a master admin",
  password_reset: "Reset a password",
  password_changed: "Changed own password",
  revoked_in_apps: "Revoked access in all apps",
};

const PAGE_SIZE = 50;

/** Sign-ins, failed sign-ins, tool launches and admin changes, newest first, in India time. */
export default function ActivityPage() {
  const [type, setType] = useState<ActivityType | "">("");
  const { results, status, loadMore } = usePaginatedQuery(
    api.activity.list,
    { type: type === "" ? undefined : type },
    { initialNumItems: PAGE_SIZE },
  );
  return (
    <>
      <PageHeader title="Activity" description="Everything that happens in the hub. Times are India time." />
      <Field id="type" label="Show" className="max-w-xs">
        {(p) => (
          <NativeSelect {...p} value={type} onChange={(e) => setType(e.target.value as ActivityType | "")}>
            <option value="">Everything</option>
            {(Object.keys(LABELS) as ActivityType[]).map((key) => (
              <option key={key} value={key}>
                {LABELS[key]}
              </option>
            ))}
          </NativeSelect>
        )}
      </Field>
      {status === "LoadingFirstPage" ? (
        <LoadingState />
      ) : results.length === 0 ? (
        <EmptyState title="Nothing here yet" />
      ) : (
        <Card className="overflow-x-auto">
          <Table>
            <THead>
              <TR>
                <TH>When</TH>
                <TH>Who</TH>
                <TH>What</TH>
                <TH>Details</TH>
              </TR>
            </THead>
            <TBody>
              {results.map((entry) => (
                <TR key={entry._id}>
                  <TD className="whitespace-nowrap">{formatDateTime(entry.createdAt)}</TD>
                  <TD>{entry.actorName ?? <span className="text-foreground-secondary">—</span>}</TD>
                  <TD>{LABELS[entry.type]}</TD>
                  <TD className="text-foreground-secondary">{details(entry)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}
      {status === "CanLoadMore" || status === "LoadingMore" ? (
        <div className="flex justify-center">
          <Button variant="secondary" loading={status === "LoadingMore"} onClick={() => loadMore(PAGE_SIZE)}>
            Show older
          </Button>
        </div>
      ) : null}
    </>
  );
}

function details(entry: Doc<"activityLog">): string {
  const phone = entry.phone ? formatPhoneForDisplay(entry.phone) : "";
  switch (entry.type) {
    case "tool_launched":
      return findTool(entry.toolId ?? "")?.name ?? entry.toolId ?? "";
    case "login":
    case "login_failed":
      return phone;
    case "password_changed":
      return "";
    default:
      return [entry.targetName, phone].filter(Boolean).join(", ");
  }
}
