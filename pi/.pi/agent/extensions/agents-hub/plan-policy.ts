import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { AgentManager } from "./manager.ts";

/** Cooperative integration with the local plan gate; not a sandbox. */
export function installPlanPolicy(pi: ExtensionAPI, manager: () => AgentManager | undefined) {
  let restricted = false;
  const connected = () => [...(manager()?.agents.values() ?? [])].filter(a =>
    a.state === "starting" || a.state === "running" || a.state === "idle" ||
    (a.transport && !a.transportClosed));

  pi.events.on("plan-mode:state", value => {
    const state = value as { version?: number; mode?: string } | undefined;
    if (state?.version === 1) restricted = state.mode === "plan";
  });
  pi.events.on("plan-mode:before-enter", value => {
    const request = value as { block(reason: string): void };
    if (connected().length) request.block("Stop all connected agents in Agents Hub before entering plan mode (idle connections count).");
  });
  pi.events.on("plan-mode:quiesce", value => {
    const request = value as { waitUntil(work: Promise<unknown>): void };
    // Branch restoration is not an explicit command that can simply be vetoed.
    // The plan gate blocks all tools until these owned processes are closed.
    const hub = manager();
    if (hub) request.waitUntil(Promise.all(connected().map(a => hub.stop(a.id))));
  });
  return {
    assertCanWork() {
      // Query rather than rely on extension discovery/session_start order.
      pi.events.emit("plan-mode:request-state", undefined);
      if (restricted) throw new Error("Plan mode blocks agent launch and messages. Review/approve the plan or explicitly leave planning restrictions first.");
    },
  };
}
