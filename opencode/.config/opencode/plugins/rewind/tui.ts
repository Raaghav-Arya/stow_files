import { Plugin } from "@opencode/plugin/tui"

export default Plugin.define({
  id: "raaghav.rewind.tui",
  setup(context) {
    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "raaghav.rewind.open",
          title: "Open session timeline",
          group: "Session",
          slash: { name: "rewind" },
          enabled: () => true,
          run: () => context.keymap.dispatch("session.timeline"),
        },
      ],
    }))
  },
})
