import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Sends changes the tools haven't confirmed yet (retries after a tool was down).
crons.interval("send changes to the tools", { minutes: 1 }, internal.syncNode.sendDue, {});

export default crons;
