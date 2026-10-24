import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { defaultTools, validateTools } from "./tools.ts";

export interface AgentDefinition {
  name: string; description: string; prompt: string; path: string;
  source: "user" | "project";
  model?: string; provider?: string; thinking?: string; tools: string[];
}
const thinkingLevels = ["off", "minimal", "low", "medium", "high", "xhigh", "max"];
const supported = new Set(["name", "description", "model", "provider", "thinking", "tools"]);

export function parseDefinition(content: string, path: string, source: AgentDefinition["source"]): AgentDefinition {
  const { frontmatter: f, body } = parseFrontmatter(content);
  for (const key of Object.keys(f)) if (!supported.has(key)) throw new Error(`Unsupported agent field: ${key}`);
  if (typeof f.name !== "string" || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(f.name)) throw new Error("name must be lowercase letters, digits or hyphens (1..64)");
  if (typeof f.description !== "string" || !f.description.trim()) throw new Error("description is required");
  if (!body.trim()) throw new Error("Agent instructions are empty");
  for (const key of ["model", "provider", "thinking"] as const) if (f[key] !== undefined && (typeof f[key] !== "string" || !f[key].trim())) throw new Error(`${key} must be a nonempty string`);
  if (f.thinking && !thinkingLevels.includes(String(f.thinking))) throw new Error("Unsupported thinking level");
  const tools = f.tools === undefined ? undefined : typeof f.tools === "string" ? f.tools.split(",").map((s) => s.trim()) : f.tools;
  const selectedTools = validateTools(tools === undefined ? defaultTools : tools);
  let model = f.model as string | undefined;
  let provider = f.provider as string | undefined;
  if (model?.includes("/")) {
    const index = model.indexOf("/");
    if (provider && provider !== model.slice(0, index)) throw new Error("provider conflicts with model provider prefix");
    provider = model.slice(0, index); model = model.slice(index + 1);
    if (!provider || !model) throw new Error("Invalid provider/model");
  }
  return { name: f.name, description: f.description, prompt: body.trim(), path, source,
    model, provider, thinking: f.thinking as string | undefined, tools: selectedTools };
}

export function discoverDefinitions(userDirectory: string, projectDirectory: string, projectTrusted: boolean) {
  const agents = new Map<string, AgentDefinition>();
  const diagnostics: string[] = [];
  for (const [directory, source] of [[userDirectory, "user"], [projectDirectory, "project"]] as const) {
    if (!existsSync(directory)) continue;
    if (source === "project" && !projectTrusted) {
      diagnostics.push(`Project agent definitions skipped (project not trusted): ${directory}`);
      continue;
    }
    try {
      for (const file of readdirSync(directory).filter((name) => name.endsWith(".md")).sort()) {
        const path = join(directory, file);
        try {
          if (statSync(path).size > 128 * 1024) throw new Error("Definition exceeds 128 KiB");
          const agent = parseDefinition(readFileSync(path, "utf8"), path, source);
          if (agents.has(agent.name)) diagnostics.push(`${agent.name}: ${path} overrides ${agents.get(agent.name)!.path}`);
          agents.set(agent.name, agent);
        } catch (error) { diagnostics.push(`${path}: ${String(error)}`); }
      }
    } catch (error) { diagnostics.push(`${directory}: ${String(error)}`); }
  }
  return { agents: [...agents.values()], diagnostics };
}
