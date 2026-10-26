/**
 * Stash Prompt Extension
 *
 * Implements Ctrl+S stash/restore behavior like Claude Code:
 * - Press Ctrl+S with text in composer → stash the prompt and clear the editor
 * - Press Ctrl+S on empty editor → restore the stashed prompt (and clear the stash)
 * - Submit a message (Enter) → restore the stashed prompt into the editor (and clear the stash)
 */
import type { ExtensionAPI, ExtensionContext, InputEvent } from "@oh-my-pi/pi-coding-agent";
import { Key } from "@oh-my-pi/pi-tui";

let stashedPrompt: string | null = null;

export default function stashPromptExtension(pi: ExtensionAPI) {
	pi.logger.info("StashPrompt extension loaded");
	pi.registerShortcut(Key.ctrl("s"), {
		description: "Stash/restore prompt (Claude Code style)",
		handler: async (ctx: ExtensionContext) => {
			const currentText = ctx.ui.getEditorText().trim();

			if (currentText) {
				// Stash current prompt and clear editor
				stashedPrompt = currentText;
				ctx.ui.setEditorText("");
				ctx.ui.notify("Prompt stashed. Press Ctrl+S again to restore.", "info");
			} else if (stashedPrompt !== null) {
				// Restore stashed prompt and clear the stash
				ctx.ui.setEditorText(stashedPrompt);
				ctx.ui.notify("Prompt restored.", "info");
				stashedPrompt = null;
			}
			// If no text and no stash: do nothing
		},
	});

	// On user message submit (input event): restore stash into editor if empty
	pi.on("input", async (_event: InputEvent, ctx: ExtensionContext) => {
		if (stashedPrompt !== null && !ctx.ui.getEditorText().trim()) {
			ctx.ui.setEditorText(stashedPrompt);
			ctx.ui.notify("Stashed prompt restored.", "info");
			stashedPrompt = null;
		}
	});

	// Clear stash on session start
	pi.on("session_start", async () => {
		stashedPrompt = null;
	});
}