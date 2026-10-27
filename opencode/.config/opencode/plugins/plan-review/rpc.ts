import { Rpc } from "@opencode/plugin/rpc"

export const PlanReview = Rpc.define({
  id: "raaghav.plan-review",
  methods: {
    get: {
      input: {
        type: "object",
        properties: {
          sessionID: { type: "string" },
          revision: { type: "string" },
          digest: { type: "string" },
        },
        required: ["sessionID", "revision", "digest"],
        additionalProperties: false,
      },
      output: {
        type: "object",
        properties: {
          text: { type: "string" },
          path: { type: "string" },
          originMessageID: { type: "string" },
          userMessageID: { type: "string" },
        },
        required: ["text", "path", "originMessageID", "userMessageID"],
        additionalProperties: false,
      },
      errors: {
        not_found: {
          type: "object",
          properties: { revision: { type: "string" } },
          required: ["revision"],
        },
      },
    },
  },
  events: {},
} as const)
