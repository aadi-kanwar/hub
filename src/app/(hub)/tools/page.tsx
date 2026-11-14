"use client";

import { useAction } from "convex/react";
import { ArrowRight } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import type { FunctionReturnType } from "convex/server";
import { useMe } from "@/components/app/session";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { LoadingState } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { toast } from "@/components/ui/toaster";
import { useQuery } from "@/lib/convex";
import { friendlyError } from "@/lib/errors";

type Tool = FunctionReturnType<typeof api.tools.mine>[number];

/** The launcher: one card per tool this person's profile type may open. */
export default function ToolsPage() {
  const me = useMe();
  const tools = useQuery(api.tools.mine, {});
  return (
    <>
      <PageHeader
        title={me ? `Hi, ${me.name.split(" ")[0]}` : "Tools"}
        description={
          me && me.propertyNames.length > 0
            ? `${me.propertyNames.join(", ")}. Open a tool and you’re signed in to it. No second login.`
            : "Open a tool and you’re signed in to it. No second login."
        }
      />
      {tools === undefined ? (
        <LoadingState />
      ) : tools.length === 0 ? (
        <EmptyState title="No tools yet" description="Your profile doesn’t have any tools yet. Ask your PG’s admin." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li key={tool.id}>
              <ToolCard tool={tool} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function ToolCard({ tool }: { tool: Tool }) {
  const getTicket = useAction(api.launch.ticket);
  const [busy, setBusy] = useState(false);
  return (
    <Card className="h-full">
      <CardBody className="flex h-full flex-col gap-4">
        <span className="flex size-11 items-center justify-center rounded-full bg-primary-subtle text-primary-text">
          <DynamicIcon name={tool.icon as IconName} className="size-5" aria-hidden />
        </span>
        <div className="flex flex-1 flex-col gap-1">
          <h2 className="font-serif text-xl tracking-tight">{tool.name}</h2>
          <p className="text-sm text-foreground-secondary">{tool.description}</p>
        </div>
        <Button
          width="full"
          loading={busy}
          onClick={async () => {
            setBusy(true);
            try {
              const { url } = await getTicket({ toolId: tool.id });
              // Same tab: the ticket is only valid for 60 seconds and is used at once.
              window.location.assign(url);
            } catch (error) {
              toast.error(friendlyError(error));
              setBusy(false);
            }
          }}
        >
          Open
          {busy ? null : <Icon icon={ArrowRight} />}
        </Button>
      </CardBody>
    </Card>
  );
}
