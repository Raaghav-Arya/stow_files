import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";

export const STORAGE_VERSION = 1;
export const DEFAULT_SEGMENT_BYTES = 2 * 1024 * 1024;

/** Exclusive root-session writer lock. Never removes a malformed or live owner's lock. */
export function acquireOwnerLock(path: string): () => void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const token = `${process.pid}:${randomUUID()}`;
  const create = () => {
    const fd = openSync(path, "wx", 0o600);
    try { writeFileSync(fd, JSON.stringify({ pid: process.pid, token })); fsyncSync(fd); }
    finally { closeSync(fd); }
  };
  try { create(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    let owner: { pid?: number; token?: string };
    try { owner = JSON.parse(readFileSync(path, "utf8")); }
    catch { throw new Error(`Agents Hub owner lock is unreadable; inspect ${path} before removing it`); }
    if (!Number.isInteger(owner.pid) || (owner.pid as number) < 1 || typeof owner.token !== "string")
      throw new Error(`Agents Hub owner lock is invalid; inspect ${path} before removing it`);
    let alive = true;
    try { process.kill(owner.pid!, 0); } catch (probe) { alive = (probe as NodeJS.ErrnoException).code === "EPERM"; }
    if (alive) throw new Error(`Agents Hub root session is already owned by process ${owner.pid}`);
    const before = statSync(path);
    const current = JSON.parse(readFileSync(path, "utf8"));
    const after = statSync(path);
    if (before.ino !== after.ino || current.token !== owner.token) throw new Error("Agents Hub lock changed during stale-owner check; retry");
    unlinkSync(path);
    create();
  }
  return () => {
    try { const current = JSON.parse(readFileSync(path, "utf8")); if (current.token === token) unlinkSync(path); } catch { /* already released or replaced */ }
  };
}

/** Atomic owner-only JSON replacement; a failed write is propagated to the caller. */
export function writeJsonAtomic(path: string, value: unknown): void {
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  let fd: number | undefined;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, JSON.stringify(value, null, 2));
    fsyncSync(fd);
    closeSync(fd); fd = undefined;
    renameSync(temporary, path);
  } catch (error) {
    if (fd !== undefined) closeSync(fd);
    try { if (existsSync(temporary)) unlinkSync(temporary); } catch { /* preserve original failure */ }
    throw error;
  }
}


/** Append-only JSONL journal, rotating to numbered archives instead of hard-failing at a tiny lifetime cap. */
export class RotatingJournal {
  private bytes: number;
  constructor(readonly path: string, private maxSegmentBytes = DEFAULT_SEGMENT_BYTES, private maxArchives = 16) {
    if (!Number.isInteger(maxSegmentBytes) || maxSegmentBytes < 1024) throw new Error("Journal segment size must be at least 1024 bytes");
    if (!Number.isInteger(maxArchives) || maxArchives < 1 || maxArchives > 256) throw new Error("Invalid journal archive count");
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.bytes = existsSync(path) ? statSync(path).size : 0;
  }
  append(value: unknown): void {
    const line = JSON.stringify({ version: STORAGE_VERSION, ...value as object }) + "\n";
    const size = Buffer.byteLength(line);
    // RPC permits records up to 4 MiB. A single bounded large tool event may
    // exceed the nominal segment size; rotate before it and keep it intact.
    if (size > Math.max(this.maxSegmentBytes * 4, 8 * 1024 * 1024)) throw new Error("Journal record exceeds the 8 MiB safety bound");
    if (this.bytes && this.bytes + size > this.maxSegmentBytes) this.rotate();
    appendFileSync(this.path, line, { encoding: "utf8", mode: 0o600 });
    this.bytes += size;
  }
  private rotate(): void {
    const oldest = `${this.path}.${this.maxArchives}`;
    if (existsSync(oldest)) unlinkSync(oldest);
    for (let index = this.maxArchives - 1; index >= 1; index--) {
      const from = `${this.path}.${index}`;
      if (existsSync(from)) renameSync(from, `${this.path}.${index + 1}`);
    }
    if (existsSync(this.path)) renameSync(this.path, `${this.path}.1`);
    this.bytes = 0;
  }
}

/** Read valid JSONL records in archive order; malformed/truncated lines are reported, never silently trusted. */
export function readJournal(path: string, maxArchives = 16): { records: unknown[]; errors: string[] } {
  if (!Number.isInteger(maxArchives) || maxArchives < 1 || maxArchives > 256) throw new Error("Invalid journal archive count");
  const paths = Array.from({ length: maxArchives }, (_, i) => `${path}.${maxArchives - i}`).filter(existsSync);
  if (existsSync(path)) paths.push(path);
  const records: unknown[] = [], errors: string[] = [];
  for (const file of paths) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (let index = 0; index < lines.length; index++) {
      if (!lines[index]) continue;
      try { records.push(JSON.parse(lines[index])); }
      catch { errors.push(`${file}:${index + 1}: invalid or truncated JSONL record`); }
    }
  }
  return { records, errors };
}
