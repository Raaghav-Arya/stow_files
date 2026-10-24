/** Explicitly loaded by child RPC processes only. No recursive agent tools. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function (pi: ExtensionAPI) {
  if (process.env.PI_AGENTS_HUB_CHILD !== "1") return;
  pi.registerTool({
    name: "message_parent",
    label: "Message main session",
    description: "Send progress, a question, blocker or result to the main session. Does not wait for a reply or wake an idle parent. Continue useful work or finish; the parent can message you later.",
    parameters: Type.Object({ message: Type.String({ minLength: 1, maxLength: 8000 }) }),
    async execute(_id, { message }) {
      return {
        content: [{ type: "text", text: "Message emitted to the parent transport. This is not an acknowledgement that the parent has read or acted on it." }],
        details: { parentMessage: message },
      };
    },
  });
}
