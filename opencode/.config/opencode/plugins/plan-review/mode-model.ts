export function shouldApplyModeModel(previousAgent: string | undefined, nextAgent: string) {
  return previousAgent !== undefined
    && previousAgent !== nextAgent
    && (nextAgent === "plan" || nextAgent === "build")
}
