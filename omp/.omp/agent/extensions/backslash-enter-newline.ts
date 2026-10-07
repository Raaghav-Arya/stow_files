import { CustomEditor } from "@oh-my-pi/pi-tui/prompt/custom-editor";
import type { TUI } from "@oh-my-pi/pi-tui";
import type { EditorTheme } from "@oh-my-pi/pi-tui/components/editor";
import type { KeybindingsManager } from "@oh-my-pi/pi-tui/app-keybindings";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/**
 * Custom editor that adds backslash+Enter → newline behavior (like pi-cli, Claude Code).
 * When user types `\` followed by Enter, it inserts a newline instead of submitting.
 */
class BackslashEnterEditor extends CustomEditor {
  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
  }

  override handleInput(data: string): void {
    // Check if this is a plain Enter key (submit)
    const isEnter = data === "\n" || data === "\r";

    // Check if the character before cursor is a backslash
    const currentLine = this.getLines()[this.getCursor().line] ?? "";
    const cursorCol = this.getCursor().col;
    const hasBackslashBeforeCursor = cursorCol > 0 && currentLine[cursorCol - 1] === "\\";

    if (isEnter && hasBackslashBeforeCursor && !this.disableSubmit) {
      // Remove the backslash and insert a newline instead of submitting
      // Using public APIs: deleteBeforeCursor(1) removes char before cursor
      // insertText("\n") inserts a newline at cursor position
      this.deleteBeforeCursor(1);
      this.insertText("\n");
      return;
    }

    // Fall through to default handling
    super.handleInput(data);
  }
}

/**
 * Factory function for the custom editor component.
 */
function createBackslashEnterEditor(
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager
): BackslashEnterEditor {
  return new BackslashEnterEditor(tui, theme, keybindings);
}

export default function (omp: ExtensionAPI) {
  // Register the custom editor component when a session starts
  omp.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.hasUI) {
      ctx.ui.setEditorComponent(createBackslashEnterEditor);
    }
  });

  // Clean up on session shutdown
  omp.on("session_shutdown", async () => {
    // The editor component will be automatically cleaned up when the session ends
  });
}