import { Plugin } from "@opencode/plugin"
import { READY } from "./workflow.ts"

export default Plugin.define({
  id: "raaghav.plan-review",
  async setup(ctx) {
    await ctx.session.hook("context", (event) => {
      if (event.agent !== "plan") return
      event.system.push({ type: "text", text: `When an implementation plan is ready for approval, return the complete Markdown plan with ordered '- [ ]' TODOs and a '## Verification' section. End it with ${READY} on its own line. Do not include this marker on clarification questions, status updates, research-only answers, or incomplete plans. The plan-review plugin saves and displays this revision and asks for approval automatically; do not implement it yourself.` })
    })
    await ctx.session.hook("prompt", async (event) => {
      const session = await ctx.session.get({ sessionID: event.sessionID })
      if (session.agent !== "plan" && session.agent !== "build") return
      const { data: agent } = await ctx.agent.get({ agentID: session.agent })
      if (agent.model && JSON.stringify(session.model) !== JSON.stringify(agent.model)) {
        await ctx.session.switchModel({ sessionID: event.sessionID, model: agent.model })
      }
    })
  },
})
