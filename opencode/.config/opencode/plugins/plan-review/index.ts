import { Plugin } from "@opencode/plugin"
import { READY, savePlan, loadPlan } from "./plan.ts"
import { PlanReview } from "./rpc.ts"

export default Plugin.define({
  id: "raaghav.plan-review",
  async setup(ctx) {
    await ctx.rpc.register(PlanReview, {
      get: async (input, rpcContext) => {
        const request = input as { sessionID: string; revision: string; digest: string }
        try {
          const record = await loadPlan(request.sessionID, request.revision, request.digest)
          return {
            text: record.text,
            path: record.path,
            originMessageID: record.originMessageID,
            userMessageID: record.userMessageID,
          }
        } catch {
          return rpcContext.error("not_found", "Saved plan revision is missing or failed integrity validation", { revision: request.revision })
        }
      },
    })
    await ctx.session.hook("context", (event) => {
      if (event.agent !== "plan") return
      event.system.push({ type: "text", text: `When an implementation plan is ready for approval, submit the complete Markdown plan using the plan_review_submit tool. Then respond with only the short receipt returned by the tool and end with ${READY} on its own line. Do not include the plan body in your final response. Do not use this tool or marker for clarification questions, status updates, research-only answers, or incomplete plans. The TUI displays the saved revision and asks for approval; do not implement it yourself.` })
    })
    await ctx.tool.transform((editor) => {
      editor.add({
        name: "plan_review_submit",
        description: "Save a complete implementation plan for user review. Use only when the plan is ready for approval.",
        input: {
          type: "object",
          properties: { markdown: { type: "string", description: "The complete implementation plan in Markdown" } },
          required: ["markdown"],
          additionalProperties: false,
        },
        execute: async (input, context) => {
          if (context.agent !== "plan") throw new Error("Only the Plan agent may submit a plan for review")
          const messages = await ctx.session.context({ sessionID: context.sessionID })
          const userMessageID = [...messages].reverse().find((message) => message.type === "user")?.id
          if (!userMessageID) throw new Error("Could not bind plan revision to a user request")
          const record = await savePlan(context.sessionID, (input as { markdown: string }).markdown, undefined, {
            originMessageID: context.messageID,
            userMessageID,
          })
          return { content: `Plan saved for review. Revision: ${record.revision}; digest: ${record.digest}` }
        },
      })
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
