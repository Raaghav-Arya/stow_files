import { matchesKey } from "@oh-my-pi/pi-tui";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/**
 * `\` + Enter inserts a newline instead of submitting.
 * Uses a terminal input listener rather than replacing the editor, so the
 * built-in editor (and the user's keybindings) stay intact.
 */
export default function (omp: ExtensionAPI) {
  let unsubscribe: (() => void) | undefined;

  omp.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    if (!ctx.hasUI) return;
    unsubscribe?.();
    unsubscribe = ctx.ui.onTerminalInput((data) => {
      if (!matchesKey(data, "enter")) return undefined;
      const text = ctx.ui.getEditorText();
      if (!text.endsWith("\\")) return undefined;
      ctx.ui.setEditorText(`${text.slice(0, -1)}\n`);
      return { consume: true };
    });
  });

  omp.on("session_shutdown", async () => {
    unsubscribe?.();
    unsubscribe = undefined;
  });
}
