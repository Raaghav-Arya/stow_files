import { createHash } from "node:crypto"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { homedir } from "node:os"
import { join } from "node:path"

export const READY = "<!-- opencode-plan-ready -->"
const directory = join(homedir(), ".opencode", "plan", "review")
const hash = (text: string) => createHash("sha256").update(text).digest("hex")

export function validatePlan(text: string) {
  const value = text.trim()
  if (!/^\s*- \[ \] \S/m.test(value)) throw new Error("Plan must include at least one unchecked '- [ ]' TODO")
  if (!/^#{1,3} .*\b(test|verif|validation|acceptance)/im.test(value)) {
    throw new Error("Plan must include a verification, testing, validation, or acceptance heading")
  }
  return value
}

export type PlanRecord = { sessionID: string; revision: string; digest: string; text: string; path: string; originMessageID: string; userMessageID: string }

function validateRecord(value: unknown, expected: { sessionID: string; revision: string; digest: string; path: string }): PlanRecord {
  if (!value || typeof value !== "object") throw new Error("Saved plan metadata is invalid")
  const record = value as Partial<PlanRecord>
  if (typeof record.sessionID !== "string" || typeof record.revision !== "string"
    || typeof record.digest !== "string" || typeof record.path !== "string"
    || typeof record.originMessageID !== "string" || !record.originMessageID
    || typeof record.userMessageID !== "string" || !record.userMessageID) {
    throw new Error("Saved plan metadata is incomplete")
  }
  if (record.sessionID !== expected.sessionID || record.revision !== expected.revision
    || record.digest !== expected.digest || record.path !== expected.path
    || hash(`${record.sessionID}:${record.originMessageID}:${record.digest}`).slice(0, 32) !== record.revision) {
    throw new Error("Plan reference does not match this session or originating turn")
  }
  return record as PlanRecord
}

export async function savePlan(
  sessionID: string,
  text: string,
  root = directory,
  binding: { originMessageID?: string; userMessageID?: string } = {},
) {
  const value = validatePlan(text)
  const digest = hash(value)
  const originMessageID = binding.originMessageID ?? "test-origin"
  const userMessageID = binding.userMessageID ?? "test-user"
  const revision = hash(`${sessionID}:${originMessageID}:${digest}`).slice(0, 32)
  const path = join(root, `${revision}.md`)
  await mkdir(root, { recursive: true, mode: 0o700 })
  try {
    await writeFile(path, `${value}\n`, { flag: "wx", mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    if (await readFile(path, "utf8") !== `${value}\n`) throw new Error("Saved plan revision differs; refusing to overwrite it")
  }
  const record = {
    sessionID, revision, digest, path,
    originMessageID,
    userMessageID,
  }
  const metadataPath = join(root, `${revision}.json`)
  try {
    await writeFile(metadataPath, JSON.stringify(record), { flag: "wx", mode: 0o600 })
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error
    const existing = validateRecord(JSON.parse(await readFile(metadataPath, "utf8")), { sessionID, revision, digest, path })
    if (existing.originMessageID !== originMessageID || existing.userMessageID !== userMessageID) {
      throw new Error("Plan revision binding mismatch")
    }
  }
  return record
}

export async function loadPlan(sessionID: string, revision: string, digest: string, root = directory): Promise<PlanRecord> {
  if (!/^[a-f0-9]{32}$/.test(revision) || !/^[a-f0-9]{64}$/.test(digest)) {
    throw new Error("Invalid saved plan reference")
  }
  const path = join(root, `${revision}.md`)
  const record = validateRecord(JSON.parse(await readFile(join(root, `${revision}.json`), "utf8")), { sessionID, revision, digest, path })
  const text = await readFile(path, "utf8")
  if (!text.endsWith("\n") || hash(text.trimEnd()) !== digest) throw new Error("Saved plan revision failed integrity validation")
  return { ...record, text: text.trimEnd() }
}
