/** PI-006: session-local text-only prompt stash; no editor replacement. */
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const STATUS_KEY = "prompt-stash";

export default function promptStash(pi: ExtensionAPI): void {
  let saved: string | undefined;

  const status = (ctx: ExtensionContext): void => {
    ctx.ui.setStatus(STATUS_KEY, saved === undefined ? undefined : "Stash: 1 | restores after send · Ctrl+S restore");
  };

  const restore = (ctx: ExtensionContext): void => {
    if (saved === undefined) return;
    try {
      ctx.ui.setEditorText(saved);
      saved = undefined; // Consume only after a successful write.
      ctx.ui.notify("Stashed prompt text restored.", "info");
    } catch {
      ctx.ui.notify("Could not restore input; stash retained. Check the editor before continuing.", "error");
    }
    status(ctx);
  };

  // Pi clears the submitted editor before emitting interactive input. The event
  // already owns the submitted text; restoring the draft does not change it.
  // Ignore RPC/extension-generated input and never overwrite a newer draft.
  pi.on("input", (event, ctx) => {
    if (ctx.mode !== "tui" || event.source !== "interactive" || saved === undefined) return;
    if (!event.text.trim() && !event.images?.length) return;
    if (ctx.ui.getEditorText().length === 0) restore(ctx);
  });

  pi.registerShortcut("ctrl+s", {
    description: "Stash prompt text / restore into empty input (session-local)",
    handler(ctx) {
      if (ctx.mode !== "tui") return;
      const draft = ctx.ui.getEditorText(); // Pi expands collapsed paste blocks.
      if (draft.length > 0) {
        // Explicit Ctrl+S on a new draft replaces the previous stash.
        // Capture before clearing. If the editor setter fails, keep the recovery
        // copy rather than risking loss (even if the setter partially mutated).
        saved = draft;
        try {
          ctx.ui.setEditorText("");
          ctx.ui.notify("Prompt stashed!", "info");
        } catch {
          ctx.ui.notify("Could not clear input; stash retained. Check the editor before continuing.", "error");
        }
      } else if (saved !== undefined) {
        restore(ctx);
      } else {
        ctx.ui.notify("No stashed prompt text in this session.", "info");
      }
      status(ctx);
    },
  });

  pi.on("session_start", (_event, ctx) => {
    saved = undefined;
    if (ctx.mode === "tui") status(ctx);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    saved = undefined;
    if (ctx.mode === "tui") status(ctx);
  });
}
