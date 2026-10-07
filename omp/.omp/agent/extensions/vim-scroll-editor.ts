import { CustomEditor } from "@oh-my-pi/pi-tui/prompt/custom-editor";
import type { TUI } from "@oh-my-pi/pi-tui";
import type { EditorTheme } from "@oh-my-pi/pi-tui/components/editor";
import type { KeybindingsManager } from "@oh-my-pi/pi-tui/app-keybindings";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

/**
 * Internal editor methods needed for half-page scroll.
 * These are private in the Editor class but accessible at runtime via bracket notation.
 */
type EditorInternals = {
  /** Build visual line map for rendering */
  buildVisualLineMap: (caretRowWidth: number) => readonly { logicalLine: number; visualLine: number }[];
  /** Find current visual line index */
  findCurrentVisualLine: (visualLines: readonly { logicalLine: number; visualLine: number }[]) => number;
  /** Caret row width for layout */
  caretRowWidth: number;
  /** Maximum editor height */
  maxHeight: number | undefined;
  /** Get visible content height */
  getVisibleContentHeight: (totalVisualLines: number) => number;
  /** Move to a specific visual line */
  moveToVisualLine: (
    visualLines: readonly { logicalLine: number; visualLine: number }[],
    fromVisualLine: number,
    toVisualLine: number
  ) => void;
};

/**
 * Custom editor that adds vim-style scrolling keybindings:
 * - j/k for up/down (in vim normal mode) - already works with vim mode
 * - ctrl+u for half page scroll up
 * - ctrl+d for half page scroll down
 */
class VimScrollEditor extends CustomEditor {
  private tuiRef: TUI;

  constructor(tui: TUI, theme: EditorTheme, keybindings: KeybindingsManager) {
    super(tui, theme, keybindings);
    this.tuiRef = tui;
    // Enable vim mode for j/k navigation in normal mode
    this.setVimMode(true);
  }

  override handleInput(data: string): void {
    // Check for ctrl+u (half page up) and ctrl+d (half page down)
    // These are control characters: ctrl+u = 0x15, ctrl+d = 0x04
    const isCtrlU = data === "\x15"; // Ctrl+U
    const isCtrlD = data === "\x04"; // Ctrl+D

    if (isCtrlU || isCtrlD) {
      // Handle half-page scroll using internal editor methods
      this.#handleHalfPageScroll(isCtrlU ? -1 : 1);
      return;
    }

    // Fall through to default handling (includes vim mode handling)
    super.handleInput(data);
  }

  /**
   * Scroll by half a page using internal editor methods.
   * Accesses private methods via bracket notation at runtime.
   */
  #handleHalfPageScroll(direction: -1 | 1): void {
    // Access private methods via bracket notation (runtime access)
    const self = this as unknown as EditorInternals;
    
    // Use bracket notation to access private fields at runtime
    const editor = this as any;
    const visualLines = editor["#buildVisualLineMap"](editor["#caretRowWidth"]);
    const currentVisualLine = editor["#findCurrentVisualLine"](visualLines);
    const visibleHeight = editor["#maxHeight"] === undefined
      ? 10
      : editor["#getVisibleContentHeight"](visualLines.length);
    const halfPageStep = Math.max(1, Math.floor(visibleHeight / 2));

    const targetVisualLine = Math.max(
      0,
      Math.min(visualLines.length - 1, currentVisualLine + direction * halfPageStep)
    );

    if (targetVisualLine !== currentVisualLine) {
      editor["#moveToVisualLine"](visualLines, currentVisualLine, targetVisualLine);
    }
  }
}

/**
 * Factory function for the custom editor component.
 */
function createVimScrollEditor(
  tui: TUI,
  theme: EditorTheme,
  keybindings: KeybindingsManager
): VimScrollEditor {
  return new VimScrollEditor(tui, theme, keybindings);
}

export default function (omp: ExtensionAPI) {
  // Register the custom editor component when a session starts
  omp.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
    if (ctx.hasUI) {
      ctx.ui.setEditorComponent(createVimScrollEditor);
    }
  });

  // Clean up on session shutdown
  omp.on("session_shutdown", async () => {
    // The editor component will be automatically cleaned up when the session ends
  });
}