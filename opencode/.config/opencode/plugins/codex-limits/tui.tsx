import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { spawn } from "node:child_process"
import { createInterface } from "node:readline"

type UsageWindow = {
  usedPercent: number
  resetsAt?: number
}

type Limits = {
  fiveHour?: UsageWindow
  weekly?: UsageWindow
  fetchedAt: number
}

type JsonObject = Record<string, unknown>

const REQUEST_TIMEOUT = 12_000

function object(value: unknown): JsonObject | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined
}

function numberField(source: JsonObject, ...keys: string[]): number | undefined {
  for (const key of keys) {
    const value = source[key]
    if (typeof value === "number" && Number.isFinite(value)) return value
  }
  return undefined
}

function parseWindow(value: unknown, expectedMinutes: number): UsageWindow | undefined {
  const source = object(value)
  if (!source) return undefined

  const duration = numberField(
    source,
    "windowDurationMins",
    "window_duration_mins",
    "windowMinutes",
    "window_minutes",
  )
  const usedPercent = numberField(source, "usedPercent", "used_percent")
  if (duration !== expectedMinutes || usedPercent === undefined) return undefined

  const reset = numberField(source, "resetsAt", "resets_at", "resetAt", "reset_at")
  return {
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
    resetsAt: reset,
  }
}

export function parseRateLimits(response: unknown): Limits {
  const result = object(object(response)?.result)
  const rateLimits = object(result?.rateLimits ?? result?.rate_limits)
  if (!rateLimits) throw new Error("Codex did not return rate limits")

  const candidates = [rateLimits.primary, rateLimits.secondary]
  for (const item of Object.values(rateLimits)) {
    const candidate = object(item)
    if (candidate && ("windowDurationMins" in candidate || "window_duration_mins" in candidate)) {
      candidates.push(candidate)
    }
  }

  let fiveHour: UsageWindow | undefined
  let weekly: UsageWindow | undefined
  for (const candidate of candidates) {
    fiveHour ??= parseWindow(candidate, 300)
    weekly ??= parseWindow(candidate, 10_080)
  }

  return { fiveHour, weekly, fetchedAt: Date.now() }
}

function codexAppServer(): Promise<Limits> {
  return new Promise((resolve, reject) => {
    const child = spawn("codex", ["app-server", "--listen", "stdio://"], {
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    })
    const lines = createInterface({ input: child.stdout })
    const pending = new Map<number, (value: unknown) => void>()
    let nextID = 1
    let settled = false

    const finish = (error?: Error, value?: Limits) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      for (const resolveResponse of pending.values()) {
        resolveResponse({ error: error?.message ?? "Codex app-server closed" })
      }
      pending.clear()
      lines.close()
      child.kill()
      if (error) reject(error)
      else resolve(value!)
    }

    const timeout = setTimeout(
      () => finish(new Error("Codex usage request timed out")),
      REQUEST_TIMEOUT,
    )
    child.once("error", (error) => finish(new Error(`Could not start Codex app-server: ${error.message}`)))
    child.once("exit", (code) => {
      if (!settled) finish(new Error(`Codex app-server exited${code === null ? "" : ` (${code})`}`))
    })

    lines.on("line", (line) => {
      let message: JsonObject
      try {
        message = JSON.parse(line) as JsonObject
      } catch {
        return
      }
      if (typeof message.id !== "number") return
      const resolveResponse = pending.get(message.id)
      if (!resolveResponse) return
      pending.delete(message.id)
      resolveResponse(message)
    })

    const request = (method: string, params: JsonObject) => {
      const id = nextID++
      const response = new Promise<unknown>((resolveResponse) => pending.set(id, resolveResponse))
      child.stdin.write(`${JSON.stringify({ method, id, params })}\n`)
      return response
    }

    const notify = (method: string, params: JsonObject) => {
      child.stdin.write(`${JSON.stringify({ method, params })}\n`)
    }

    void (async () => {
      try {
        const initialized = object(await request("initialize", {
          clientInfo: {
            name: "opencode-codex-limits",
            title: "OpenCode Codex Limits",
            version: "1.0.0",
          },
        }))
        if (initialized?.error) throw new Error("Codex app-server initialization failed")
        notify("initialized", {})

        const response = await request("account/rateLimits/read", {})
        const message = object(response)
        if (message?.error) throw new Error("Codex could not read account rate limits")
        finish(undefined, parseRateLimits(response))
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })()
  })
}

function timeUntil(reset?: number): string | undefined {
  if (reset === undefined) return undefined
  // Codex app-server reports Unix timestamps in seconds.
  const remaining = Math.max(0, reset * 1000 - Date.now())
  const hours = Math.floor(remaining / 3_600_000)
  const minutes = Math.floor((remaining % 3_600_000) / 60_000)
  if (hours >= 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`
  if (hours > 0) return `${hours}h ${minutes}m`
  return `${minutes}m`
}

function limitColor(remaining: number): string {
  if (remaining < 25) return "#fb7185"
  if (remaining < 50) return "#fbbf24"
  return "#34d399"
}

export default Plugin.define({
  id: "raaghav.codex-limits.tui",
  async setup(context) {
    const [limits, setLimits] = createSignal<Limits>()
    const [error, setError] = createSignal<string>()
    let inFlight: Promise<void> | undefined

    const refresh = () => {
      if (inFlight) return inFlight

      inFlight = codexAppServer()
        .then((value) => {
          setLimits(value)
          setError(undefined)
        })
        .catch((reason: unknown) => {
          setError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          inFlight = undefined
        })
      return inFlight
    }

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: "raaghav.codex-limits.show",
          title: "Show Codex usage limits",
          group: "Codex",
          slash: { name: "codex-limits" },
          enabled: () => true,
          run: async () => {
            await refresh()
            context.ui.dialog.set({ size: "medium", centered: true })
            context.ui.dialog.show(
              () => {
                const current = limits()
                const renderWindow = (label: string, window?: UsageWindow) => {
                  if (!window) {
                    return <text fg={context.theme.text.muted}>{`${label}: Not reported`}</text>
                  }
                  const remaining = Math.round(100 - window.usedPercent)
                  const reset = timeUntil(window.resetsAt)
                  return (
                    <text fg={limitColor(remaining)}>
                      {`${label}: ${remaining}% remaining${reset ? ` · resets in ${reset}` : ""}`}
                    </text>
                  )
                }

                return (
                  <box flexDirection="column" gap={1}>
                    <text fg={context.theme.text.base}>Codex usage limits</text>
                    {current ? (
                      <>
                        {renderWindow("5-hour", current.fiveHour)}
                        {renderWindow("Weekly", current.weekly)}
                        <text fg={context.theme.text.muted}>
                          {`Updated ${Math.max(0, Math.floor((Date.now() - current.fetchedAt) / 60_000))}m ago${error() ? " · stale" : ""}`}
                        </text>
                      </>
                    ) : (
                      <text fg={context.theme.text.muted}>
                        {`Usage unavailable: ${error() ?? "No data returned"}`}
                      </text>
                    )}
                  </box>
                )
              },
              () => {},
            )
          },
        },
      ],
    }))
  },
})
