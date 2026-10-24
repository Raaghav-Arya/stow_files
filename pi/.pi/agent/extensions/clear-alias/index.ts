import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/** A session replacement, not a terminal clear or transcript deletion. */
export default function clearAlias(pi: ExtensionAPI) {
  pi.registerCommand("clear", {
    description: "Start a fresh session (alias for /new; keeps saved sessions)",
    handler: async (_args, ctx) => {
      // Do not wait for idle: /new aborts active work through the runtime.
      // Replacement invalidates ctx, so do not use it after this await.
      await ctx.newSession();
    },
  });
}
