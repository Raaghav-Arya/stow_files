import { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle, type ScrollBoxRenderable, type TextareaRenderable } from "@opentui/core"
import { createSignal, onMount } from "solid-js"
import { PlanReview } from "./rpc.ts"
import { createReviewController, type ReviewState } from "./workflow.ts"

const PANEL = "raaghav.plan-review"

function FeedbackDialog(props: {
  context: Plugin.Context
  submit: (value: string) => void
  cancel: () => void
}) {
  let editor: TextareaRenderable | undefined
  onMount(() => editor?.focus())
  props.context.keymap.layer(() => ({
    mode: "modal",
    target: () => editor,
    priority: 2,
    commands: [{
      id: "raaghav.plan-review.feedback.submit",
      title: "Submit plan feedback",
      bind: "ctrl+enter",
      run: () => props.submit(editor?.plainText ?? ""),
    }, {
      id: "raaghav.plan-review.feedback.cancel",
      title: "Cancel plan feedback",
      bind: "escape",
      run: props.cancel,
    }],
  }))
  return (
    <box flexDirection="column" gap={1} padding={1}>
      <text fg={props.context.theme.text.base}>Describe what should change. Use Enter for new lines.</text>
      <textarea
        height={8}
        wrapMode="word"
        placeholder="Add details, constraints, or corrections…"
        focusedTextColor={props.context.theme.text.formfield.base}
        textColor={props.context.theme.text.formfield.base}
        ref={(value: TextareaRenderable) => { editor = value }}
      />
      <text fg={props.context.theme.text.muted}>Ctrl+Enter submits · Escape cancels</text>
    </box>
  )
}

function ReviewPanel(props: {
  context: Plugin.Context
  panel: { focused: boolean; sessionID: string }
  text: string
  revision: string
  path: string
  syntaxStyle: SyntaxStyle
}) {
  let scroll: ScrollBoxRenderable | undefined
  props.context.keymap.layer(() => ({
    mode: "global",
    enabled: () => props.panel.focused,
    commands: [
      { id: "raaghav.plan-review.scroll.down", bind: "j", run: () => scroll?.scrollBy(1) },
      { id: "raaghav.plan-review.scroll.up", bind: "k", run: () => scroll?.scrollBy(-1) },
      { id: "raaghav.plan-review.scroll.down.line", bind: "down", run: () => scroll?.scrollBy(1) },
      { id: "raaghav.plan-review.scroll.up.line", bind: "up", run: () => scroll?.scrollBy(-1) },
      { id: "raaghav.plan-review.scroll.page.down", bind: "pagedown", run: () => scroll?.scrollBy(Math.max(1, (scroll?.viewport.height ?? 1) - 2)) },
      { id: "raaghav.plan-review.scroll.page.up", bind: "pageup", run: () => scroll?.scrollBy(-Math.max(1, (scroll?.viewport.height ?? 1) - 2)) },
      { id: "raaghav.plan-review.scroll.home", bind: "home", run: () => scroll?.scrollTo(0) },
      { id: "raaghav.plan-review.scroll.end", bind: "end", run: () => scroll?.scrollTo(scroll?.scrollHeight ?? 0) },
    ],
  }))
  return (
    <box flexDirection="column" flexGrow={1} minHeight={0} gap={1} padding={1}>
      <box flexDirection="column" gap={1} flexShrink={0}>
        <text fg={props.context.theme.text.base}>{`PLAN REVIEW  ·  REVISION ${props.revision}`}</text>
        <text fg={props.context.theme.text.muted} wrapMode="word">{props.path}</text>
      </box>
      <scrollbox
        ref={(value: ScrollBoxRenderable) => { scroll = value }}
        flexGrow={1}
        minHeight={0}
        verticalScrollbarOptions={{
          trackOptions: {
            backgroundColor: props.context.theme.background.base,
            foregroundColor: props.context.theme.scrollbar.base,
          },
        }}
      >
        <box paddingLeft={1} paddingRight={1}>
          <markdown
            content={props.text}
            syntaxStyle={props.syntaxStyle}
            fg={props.context.theme.markdown.text}
            bg={props.context.theme.background.base}
            tableOptions={{ style: "grid", cellPaddingX: 1 }}
          />
        </box>
      </scrollbox>
      <box flexDirection="column" flexShrink={0} gap={1}>
        <text fg={props.context.theme.text.base}>Ctrl+A approve and build  ·  Ctrl+R request changes</text>
        <text fg={props.context.theme.text.muted}>j/k or ↑/↓ scroll · PgUp/PgDn page · Home/End jump · Escape closes</text>
      </box>
    </box>
  )
}

export default Plugin.define({
  id: "raaghav.plan-review.tui",
  setup(context) {
    const [state, update] = context.storage.store<ReviewState>("reviews-v3", {
      initial: { reviews: {} },
    })
    const [feedbackOpen, setFeedbackOpen] = createSignal(false)
    const [legacy] = context.storage.store<{ reviews: Record<string, { sessionID: string; formID?: string }> }>("reviews-v2", {
      initial: { reviews: {} },
    })
    const controller = createReviewController({
      client: context.client,
      state,
      update,
      idle: (id) => context.data.session.status(id) === "idle",
      notify: (message) => context.ui.toast.show({ title: "Plan review", message, variant: "error" }),
      getPlan: async (sessionID, revision, digest) => {
        const result = await context.client.rpc(PlanReview).get({ sessionID, revision, digest }) as Record<string, unknown>
        for (const field of ["text", "path", "originMessageID", "userMessageID"] as const) {
          if (typeof result[field] !== "string") throw new Error(`Plan review RPC returned invalid ${field}`)
        }
        return {
          text: result.text as string,
          path: result.path as string,
          originMessageID: result.originMessageID as string,
          userMessageID: result.userMessageID as string,
        }
      },
    })
    const syntaxStyle = SyntaxStyle.fromStyles(
      { default: { fg: context.theme.text.base } },
      context.renderer.nativeScene,
    )
    let disposed = false
    let running = false
    void (async () => {
      for (const review of Object.values(legacy.reviews)) {
        if (!review.formID) continue
        try {
          const form = await context.client.session.form.get({ sessionID: review.sessionID, formID: review.formID })
          if (form.state.status === "pending") {
            await context.client.session.form.cancel({ sessionID: review.sessionID, formID: review.formID })
          }
        } catch (error) {
          if (!error || typeof error !== "object" || !("_tag" in error) || error._tag !== "FormNotFoundError") {
            controller.report(error)
          }
        }
      }
    })()
    const openPanel = () => context.ui.panel.open(PANEL, { presentation: "fullscreen" })
    const currentSession = () => {
      const route = context.ui.router.current()
      return route.type === "session" ? route.sessionID : undefined
    }
    const approve = async () => {
      const sessionID = currentSession()
      if (!sessionID) return
      try {
        await controller.decide(sessionID, "approve")
        context.ui.panel.close()
      } catch (error) {
        controller.report(error)
      }
    }
    const revise = async () => {
      const sessionID = currentSession()
      if (!sessionID) return
      let resolveFeedback!: (value: string | undefined) => void
      const feedbackPromise = new Promise<string | undefined>((resolve) => { resolveFeedback = resolve })
      let settled = false
      const settle = (value: string | undefined) => {
        if (settled) return
        settled = true
        setFeedbackOpen(false)
        resolveFeedback(value)
      }
      setFeedbackOpen(true)
      context.ui.dialog.set({ size: "large", centered: true })
      context.ui.dialog.show(() => (
        <FeedbackDialog
          context={context}
          submit={(value) => { settle(value); context.ui.dialog.clear() }}
          cancel={() => { settle(undefined); context.ui.dialog.clear() }}
        />
      ), () => settle(undefined))
      const feedback = await feedbackPromise
      if (feedback === undefined) return
      if (!feedback.trim()) {
        context.ui.toast.show({ title: "Plan review", message: "Please provide nonempty feedback.", variant: "error" })
        return
      }
      try {
        await controller.decide(sessionID, "revise", feedback)
        context.ui.panel.close()
      } catch (error) {
        controller.report(error)
      }
    }
    context.ui.slot({
      append: "session.panel",
      render: (panel) => {
        if (panel.name !== PANEL) return null
        const review = state.reviews[panel.sessionID]
        if (!review) return <text fg={context.theme.text.muted}>No saved plan is available.</text>
        return <ReviewPanel context={context} panel={panel} text={review.text} revision={review.revision} path={review.path} syntaxStyle={syntaxStyle} />
      },
    })
    const tick = async () => {
      if (running || disposed) return
      running = true
      try {
        for (const session of context.data.session.list()) {
          if (disposed) break
          if (session.parentID || session.agent !== "plan" || !controller.needsDiscovery(session)) continue
          await controller.discover(session.id)
          const review = controller.get(session.id)
          const route = context.ui.router.current()
          if (review?.status === "pending" && route.type === "session" && route.sessionID === session.id) openPanel()
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
      mode: "global",
      commands: [{
        id: "raaghav.plan-review.approve",
        title: "Approve and build saved plan",
        group: "Plan review",
        bind: "ctrl+a",
        palette: true,
        enabled: () => context.ui.panel.current()?.name === PANEL && !feedbackOpen(),
        run: approve,
      }, {
        id: "raaghav.plan-review.revise",
        title: "Request changes to saved plan",
        group: "Plan review",
        bind: "ctrl+r",
        palette: true,
        enabled: () => context.ui.panel.current()?.name === PANEL && !feedbackOpen(),
        run: revise,
      }, {
        id: "raaghav.plan-review.close",
        title: "Close plan review",
        group: "Plan review",
        bind: "escape",
        enabled: () => context.ui.panel.current()?.name === PANEL && !feedbackOpen(),
        run: () => context.ui.panel.close(),
      }, {
        id: "raaghav.plan-review.reopen",
        title: "Reopen saved plan review",
        group: "Plan review",
        palette: true,
        slash: { name: "plan-review-reopen" },
        run: async () => {
          const sessionID = currentSession()
          if (!sessionID) return
          try {
            await controller.reopen(sessionID)
          } catch (error) {
            controller.report(error)
            return
          }
          if (!controller.get(sessionID)) return
          openPanel()
        },
      }],
    }))
    return () => {
      disposed = true
      stop()
      clearInterval(timer)
      controller.dispose()
      void context.renderer.idle().then(() => syntaxStyle.destroy())
    }
  },
})
