import { Plugin } from "@opencode/plugin/tui"
import { InputRenderable, TextareaRenderable } from "@opentui/core"

export default Plugin.define({
  id: "raaghav.backslash-newline.tui",
  setup(context) {
    const { renderer } = context
    const keyInput = renderer.keyInput

    if (!keyInput?.prependListener || !keyInput?.removeListener) {
      throw new Error("Backslash newline requires the OpenCode TUI key input API")
    }

    const onKeypress = (event) => {
      if (
        event.name !== "return" && event.name !== "enter"
        || event.ctrl || event.meta || event.shift || event.option || event.super || event.hyper
      ) return
      if (context.keymap.mode.current() !== "base") return

      const editor = renderer.currentFocusedEditor
      if (!(editor instanceof TextareaRenderable) || editor instanceof InputRenderable) return

      const traits = editor.traits
      if (
        traits.owner !== "opencode" || traits.role !== "prompt" || traits.status
        || traits.capture?.includes("submit")
        || traits.capture?.includes("autocomplete")
      ) return

      const cursor = editor.cursorOffset
      if (cursor < 1 || editor.getTextRange(cursor - 1, cursor) !== "\\") return

      event.preventDefault()
      event.stopPropagation()
      editor.deleteCharBackward()
      editor.newLine()
    }

    keyInput.prependListener("keypress", onKeypress)
    return () => keyInput.removeListener("keypress", onKeypress)
  },
})
