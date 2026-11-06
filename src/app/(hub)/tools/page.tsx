"use client";

import { useAction } from "convex/react";
import { ArrowRight } from "lucide-react";
import { DynamicIcon, type IconName } from "lucide-react/dynamic";
import { useState } from "react";
import { api } from "@convex/_generated/api";
import { TOOLS, type ToolConfig } from "@root/tools.config";
import { Button } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Icon } from "@/components/ui/icon";
import { PageHeader } from "@/components/ui/page-header";
import { toast } from "@/components/ui/toaster";
import { friendlyError } from "@/lib/errors";

/** The launcher: one card per tool in tools.config.ts. */
export default function ToolsPage() {
  return (
    <>
      <PageHeader
        title="Tools"
        description="Open a tool and you’re signed in to it as an admin. No second login."
      />
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {TOOLS.map((tool) => (
          <li key={tool.id}>
            <ToolCard tool={tool} />
          </li>
        ))}
      </ul>
    </>
  );
}

function ToolCard({ tool }: { tool: ToolConfig }) {
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
