export type ReviewKey = {
  name: string
  ctrl?: boolean
  meta?: boolean
  shift?: boolean
  option?: boolean
  super?: boolean
  hyper?: boolean
}

export type ReviewNavigationAction =
  | { type: "toggle" }
  | { type: "close" }
  | { type: "approve" }
  | { type: "revise" }
  | { type: "line"; amount: number }
  | { type: "page"; amount: number }
  | { type: "edge"; edge: "start" | "end" }

export function normalizedFeedback(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed.length ? trimmed : undefined
}

export function reviewNavigationAction(key: ReviewKey, active: boolean): ReviewNavigationAction | undefined {
  const plain = !key.ctrl && !key.meta && !key.option && !key.super && !key.hyper
  const control = !!key.ctrl && !key.meta && !key.shift && !key.option && !key.super && !key.hyper
  if (control && key.name.toLowerCase() === "q") return { type: "toggle" }
  if (!active) return
  if (plain && key.name === "escape") return { type: "close" }
  if (control && key.name.toLowerCase() === "a") return { type: "approve" }
  if (control && key.name.toLowerCase() === "r") return { type: "revise" }
  if (plain) {
    if (key.name === "j" || key.name === "down") return { type: "line", amount: 1 }
    if (key.name === "k" || key.name === "up") return { type: "line", amount: -1 }
    if (key.name === "pagedown") return { type: "page", amount: 1 }
    if (key.name === "pageup") return { type: "page", amount: -1 }
    if (key.name === "home") return { type: "edge", edge: "start" }
    if (key.name === "end" || key.name === "G") return { type: "edge", edge: "end" }
  }
  if (control && key.name.toLowerCase() === "u") return { type: "page", amount: -1 }
  if (control && key.name.toLowerCase() === "d") return { type: "page", amount: 1 }
  return
}

export function insertFeedbackBackslashNewline(editor: {
  cursorOffset: number
  getTextRange(start: number, end: number): string
  deleteCharBackward(): void
  newLine(): void
}): boolean {
  const cursor = editor.cursorOffset
  if (cursor < 1 || editor.getTextRange(cursor - 1, cursor) !== "\\") return false
  editor.deleteCharBackward()
  editor.newLine()
  return true
}

export function insertFeedbackNewline(editor: { newLine(): void }): void {
  editor.newLine()
}
