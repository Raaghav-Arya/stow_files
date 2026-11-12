import { Plugin } from "@opencode/plugin/tui"

const MAP = { n: "down", p: "up" }

const SEQ = { escape: "\x1b", down: "\x1b[B" }

const withKey = (event, name) => {
  const clone = Object.create(event)
  Object.defineProperties(clone, {
    name: { value: name },
    sequence: { value: SEQ[name] },
    raw: { value: SEQ[name] },
    ctrl: { value: false },
    defaultPrevented: { value: false, writable: true },
    propagationStopped: { value: false, writable: true },
  })
  return clone
}

export default Plugin.define({
  id: "local.form-ctrl-nav.tui",
  setup(context) {
    const { renderer } = context
    const keyInput = renderer.keyInput

    if (!keyInput?.prependListener || !keyInput?.removeListener || !keyInput?.emit) {
      throw new Error("form-ctrl-nav requires the OpenCode TUI key input API")
    }

    const onKeypress = (event) => {
      const target = MAP[event.name]
      if (!target || !event.ctrl || event.meta || event.shift || event.option || event.super || event.hyper) return
      if (context.keymap.mode.current() !== "form") return

      const editor = renderer.currentFocusedEditor
      if (target === "down" && editor) {
        const total = editor.virtualLineCount
        const row = (editor.scrollY ?? 0) + (editor.visualCursor?.visualRow ?? 0)
        if (typeof total === "number" && row < total - 1) {
          event.name = "down"
          event.sequence = SEQ.down
          event.ctrl = false
          return
        }
        const esc = withKey(event, "escape")
        const down = withKey(event, "down")
        event.preventDefault()
        event.stopPropagation()
        keyInput.emit("keypress", esc)
        setTimeout(() => keyInput.emit("keypress", down), 0)
        return
      }

      event.name = target
      event.sequence = target === "down" ? SEQ.down : "\x1b[A"
      event.ctrl = false
    }

    keyInput.prependListener("keypress", onKeypress)
    return () => keyInput.removeListener("keypress", onKeypress)
  },
})
