import { Plugin } from "@opencode/plugin/tui"
import { createReviewController, type ReviewState } from "./workflow.ts"

export default Plugin.define({
  id: "raaghav.plan-review.tui",
  setup(context) {
    const [state, update] = context.storage.store<ReviewState>("reviews-v2", {
      initial: { reviews: {} },
    })
    const controller = createReviewController({
      client: context.client,
      state,
      update,
      idle: (id) => context.data.session.status(id) === "idle",
      notify: (message) => context.ui.toast.show({ title: "Plan review", message, variant: "error" }),
    })
    let disposed = false
    let running = false
    const tick = async () => {
      if (running || disposed) return
      running = true
      try {
        const sessions = context.data.session.list()
        for (const session of sessions) {
          if (disposed) break
          if (!session.parentID && session.agent === "plan" && controller.needsDiscovery(session)) {
            await controller.discover(session.id)
          }
        }
        if (!disposed) await controller.reconcile()
      } catch (error) {
        controller.report(error)
      } finally {
        running = false
      }
    }
    const stop = context.data.on("session.execution.succeeded", () => void tick())
    const timer = setInterval(() => void tick(), 2000)
    void tick()
    context.keymap.layer(() => ({
      commands: [{
        id: "raaghav.plan-review.reopen",
        title: "Reopen saved plan review",
        group: "Plan review",
        palette: true,
        run: async () => {
          const route = context.ui.router.current()
          if (route.type === "session") await controller.reopen(route.sessionID).catch(controller.report)
        },
      }],
    }))
    return () => {
      disposed = true
      stop()
      clearInterval(timer)
      controller.dispose()
    }
  },
})
