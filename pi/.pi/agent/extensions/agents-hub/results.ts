import { randomUUID } from "node:crypto";
import { appendFileSync, closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export interface AgentResult {
  version: 1; id: string; agentId: string; taskId: string; revision: number;
  status: "reported" | "completed" | "failed"; createdAt: string; preview: string; artifact: string;
}

/** Append-only immutable result snapshots; an old revision is never a live output-tail alias. */
export class ResultStore {
  private readonly byKey = new Map<string, AgentResult>();
  constructor(private readonly path: string) {
    if (!existsSync(path)) return;
    for (const [index, line] of readFileSync(path, "utf8").split("\n").entries()) {
      if (!line) continue;
      let result: AgentResult;
      try { result = JSON.parse(line) as AgentResult; } catch { throw new Error(`Corrupt result journal at ${path}:${index + 1}`); }
      if (result.version !== 1 || !result.id || !result.agentId || !result.taskId || !Number.isSafeInteger(result.revision) || typeof result.artifact !== "string") throw new Error(`Invalid result record at ${path}:${index + 1}`);
      const key = this.key(result.agentId, result.taskId, result.revision, result.status);
      if (!this.byKey.has(key)) this.byKey.set(key, Object.freeze(result));
    }
  }
  private key(agentId: string, taskId: string, revision: number, status: AgentResult["status"]): string { return `${agentId}\0${taskId}\0${revision}\0${status}`; }
  put(input: Omit<AgentResult, "version" | "id" | "createdAt">): AgentResult {
    const key = this.key(input.agentId, input.taskId, input.revision, input.status);
    const existing = this.byKey.get(key);
    if (existing) return existing;
    const result: AgentResult = Object.freeze({ ...input, version: 1, id: randomUUID(), createdAt: new Date().toISOString() });
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const fd = openSync(this.path, "a", 0o600);
    try { appendFileSync(fd, `${JSON.stringify(result)}\n`, "utf8"); fsyncSync(fd); } finally { closeSync(fd); }
    this.byKey.set(key, result);
    return result;
  }
  get(agentId: string, taskId: string, revision: number): AgentResult | undefined {
    const results = [...this.byKey.values()].filter(result => result.agentId === agentId && result.taskId === taskId && result.revision === revision);
    return results.find(result => result.status === "completed" || result.status === "failed") || results.find(result => result.status === "reported");
  }
  find(agentId: string, resultId: string): AgentResult | undefined { return [...this.byKey.values()].find(result => result.agentId === agentId && result.id === resultId); }
  list(agentId: string): AgentResult[] { return [...this.byKey.values()].filter(result => result.agentId === agentId); }
}
