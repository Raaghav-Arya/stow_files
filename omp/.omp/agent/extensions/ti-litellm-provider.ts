// TI-MANAGED: OMP wrapper for TI LiteLLM provider
// This is an OMP-compatible wrapper around the TI PI Harness auth
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@oh-my-pi/pi-coding-agent";

const NODE_BIN = "/home/a0507112/.nvm/versions/node/v22.21.0/bin/node";
const TOKEN_SCRIPT = "/home/a0507112/.nvm/versions/node/v22.21.0/lib/node_modules/ti-pi-harness-install/lib/get-token.js";
const INSTALLER_CLI = "/home/a0507112/.nvm/versions/node/v22.21.0/lib/node_modules/ti-pi-harness-install/bin/ti-pi-harness-install.js";
const TI_TEAM_ID_DEFAULT = "DAP_PE_EPD_PROC_SW";
const TI_CA_BUNDLE = "/home/a0507112/.local/certs/ti-ca-bundle.pem";
const DEFAULT_BASE_URL = "https://llmgateway.itg.ti.com";
const DEFAULT_AI_GOVERNANCE_BASE_URL = "https://ai-governance-backend.lecomcpprod.itg.ti.com";

function teamId(): string {
  return process.env.TI_LITELLM_TEAM_ID || TI_TEAM_ID_DEFAULT;
}

function teamDisplayName(): string {
  return teamId().replace(/^DAP_[A-Z]+_/, "");
}

function tokenHelperEnv(team: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, TI_LITELLM_TEAM_ID: team };
  if (!env.NODE_EXTRA_CA_CERTS && fs.existsSync(TI_CA_BUNDLE)) env.NODE_EXTRA_CA_CERTS = TI_CA_BUNDLE;
  return env;
}

function fetchTiCredentials() {
  const r = spawnSync(NODE_BIN, [TOKEN_SCRIPT, "--json"], {
    encoding: "utf8",
    timeout: 35000,
    stdio: ["ignore", "pipe", "pipe"],
    env: tokenHelperEnv(teamId()),
  });
  if (r.error) throw new Error(`TI token helper failed to start: ${r.error.message}`);
  if (r.status !== 0) throw new Error(`TI token fetch failed: ${(r.stderr || "").trim() || "exit " + r.status}\nRun: kinit username@ENT.TI.COM`);
  const body = JSON.parse(r.stdout.trim());
  if (!body.access_token) throw new Error("No access_token from TI JWT issuer");
  const ttlSec = typeof body.expires_in === "number" ? body.expires_in : 600;
  return {
    refresh: "kerberos",
    access: body.access_token,
    expires: Date.now() + Math.max(ttlSec - 60, 60) * 1000,
  };
}

// ---- Budget/Cache-Hit/MTD-spend data (ported from ti-claude-statusline) ----

interface BudgetState {
  spend: number | null;
  maxBudget: number | null;
  youSpend: number | null;
  youMaxBudget: number | null;
  mtdSpend: number | null;
}

const EMPTY_BUDGET_STATE: BudgetState = {
  spend: null,
  maxBudget: null,
  youSpend: null,
  youMaxBudget: null,
  mtdSpend: null,
};

function getBudgetCachePath(): string {
  const agentDir = process.env.OMP_AGENT_DIR || path.join(os.homedir(), ".omp", "agent");
  return path.join(agentDir, "statusline-budget-cache.json");
}

const BUDGET_CACHE_TTL_MS = 60000;

interface CachedBudget {
  state: BudgetState;
  fresh: boolean;
}

function isBudgetState(value: unknown): value is BudgetState {
  return value != null &&
    ["spend", "maxBudget", "youSpend", "youMaxBudget", "mtdSpend"].every(
      (key) => (value as Record<string, unknown>)[key] === null || typeof (value as Record<string, unknown>)[key] === "number",
    );
}

function loadCachedBudget(team: string): CachedBudget | null {
  try {
    const raw = JSON.parse(fs.readFileSync(getBudgetCachePath(), "utf8"));
    if (!raw || raw.team !== team || typeof raw.savedAt !== "number" || !isBudgetState(raw.state)) {
      return null;
    }
    return {
      state: raw.state,
      fresh: Date.now() - raw.savedAt <= BUDGET_CACHE_TTL_MS,
    };
  } catch {
    return null;
  }
}

function saveCachedBudget(team: string, state: BudgetState): void {
  try {
    const cachePath = getBudgetCachePath();
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ team, state, savedAt: Date.now() }), "utf8");
  } catch {
    // best-effort cache — never let a write failure affect the session
  }
}

function decodeIdentity(token: string): string | null {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    const identity = payload?.preferred_username || payload?.sub;
    return typeof identity === "string" && identity ? identity : null;
  } catch {
    return null;
  }
}

function spawnJson(
  command: string,
  args: string[],
  timeoutMs: number,
  maxBytes: number,
  env?: NodeJS.ProcessEnv,
): Promise<unknown> {
  const { promise, resolve } = Promise.withResolvers<unknown>();
  let settled = false;
  let stdout = "";
  const finish = (value: unknown) => {
    if (settled) return;
    settled = true;
    resolve(value);
  };
  let child;
  try {
    child = spawn(command, args, {
      stdio: ["ignore", "pipe", "ignore"],
      ...(env ? { env } : {}),
    });
  } catch {
    finish(null);
    return promise;
  }
  const timer = setTimeout(() => {
    child.kill();
    finish(null);
  }, timeoutMs);
  child.stdout?.on("data", (chunk) => {
    if (settled) return;
    stdout += chunk;
    if (stdout.length > maxBytes) {
      child.kill();
      finish(null);
    }
  });
  child.on("error", () => {
    clearTimeout(timer);
    finish(null);
  });
  child.on("close", (code) => {
    clearTimeout(timer);
    if (code !== 0 || settled) return finish(null);
    try {
      finish(JSON.parse(stdout));
    } catch {
      finish(null);
    }
  });
  return promise;
}

/** Identity on the active Kerberos ticket (decoded in memory, never logged or persisted), or null when no token could be fetched. */
async function currentIdentity(): Promise<string | null> {
  const response = await spawnJson(NODE_BIN, [TOKEN_SCRIPT, "--json"], 35000, 1024 * 1024, tokenHelperEnv("")) as { access_token?: string } | null;
  return decodeIdentity(response?.access_token ?? "");
}

function governanceBaseUrl(): string {
  const configured = process.env.TI_AI_GOVERNANCE_URL || DEFAULT_AI_GOVERNANCE_BASE_URL;
  try {
    const url = new URL(configured);
    if (url.protocol !== "https:" || !url.hostname.endsWith(".itg.ti.com")) {
      return DEFAULT_AI_GOVERNANCE_BASE_URL;
    }
    return url.origin;
  } catch {
    return DEFAULT_AI_GOVERNANCE_BASE_URL;
  }
}

function getCurlCommand(): string {
  if (process.platform === "win32") {
    const root = process.env.SystemRoot || process.env.windir || "C:\\Windows";
    return `${root}\\System32\\curl.exe`;
  }
  try {
    const procVersion = fs.readFileSync("/proc/version", "utf8");
    if (/microsoft|wsl/i.test(procVersion)) {
      const probe = spawnSync("which", ["curl.exe"], {
        stdio: "pipe",
        timeout: 5000,
      });
      if (probe.status === 0) return "curl.exe";
    }
  } catch {
    // not WSL
  }
  return "curl";
}

/** GET <AI_GOVERNANCE_BASE_URL><urlPath> through platform curl. Internal TI traffic bypasses the proxy, TLS verification stays enabled, and both curl and the parent process enforce bounded timeouts. */
function governanceGet(urlPath: string): Promise<unknown> {
  return spawnJson(
    getCurlCommand(),
    [
      "-s",
      "-f",
      "--connect-timeout",
      "3",
      "--max-time",
      "5",
      "--noproxy",
      ".itg.ti.com",
      `${governanceBaseUrl()}${urlPath}`,
    ],
    6000,
    10 * 1024 * 1024,
  );
}

async function fetchAllProjects(identity: string): Promise<unknown[] | null> {
  const projects: unknown[] = [];
  const maxPages = 100;
  let page = 1;
  let totalPages = 1;
  do {
    const body = await governanceGet(
      `/project/user/${encodeURIComponent(identity)}?page=${page}&limit=100`,
    ) as { data?: unknown[]; page?: number; totalPages?: number } | null;
    if (!body || !Array.isArray(body.data)) return null;
    const bodyPage = Number(body.page ?? page);
    const bodyTotalPages = Number(body.totalPages ?? 1);
    if (!Number.isInteger(bodyPage) || bodyPage !== page ||
        !Number.isInteger(bodyTotalPages) || bodyTotalPages < page || bodyTotalPages > maxPages) {
      return null;
    }
    projects.push(...body.data);
    totalPages = bodyTotalPages;
    page++;
  } while (page <= totalPages);
  return projects;
}

async function fetchMtdSpend(identity: string): Promise<number | null> {
  try {
    const projects = await fetchAllProjects(identity);
    if (projects === null) return null;
    const active = projects.filter(
      (project: unknown) => {
        const p = project as Record<string, unknown>;
        return p?.active === true && typeof p.projectId === "string";
      },
    );
    const amounts = await Promise.all(
      active.map(async (project: unknown) => {
        const p = project as { projectId: string };
        const status = await governanceGet(
          `/project/status/${encodeURIComponent(p.projectId)}`,
        ) as { resources?: { llmTeam?: { data?: { team_info?: Record<string, unknown> } } } } | null;
        const teamInfo = status?.resources?.llmTeam?.data?.team_info;
        if (!teamInfo || typeof teamInfo.spend !== "number" || !Number.isFinite(teamInfo.spend)) {
          return null;
        }
        // Weekly-reset teams expose the month accumulator as total_spend on Governance versions that provide it. Detect by API metadata, never by project id; otherwise spend is the current MTD value.
        if (teamInfo.budget_duration === "7d" &&
            typeof teamInfo.total_spend === "number" &&
            Number.isFinite(teamInfo.total_spend)) {
          return teamInfo.total_spend;
        }
        return teamInfo.spend;
      }),
    );
    if (amounts.some((amount) => amount === null)) return null;
    return amounts.reduce((sum: number, amount) => sum + (amount || 0), 0);
  } catch {
    return null;
  }
}

/** Fetch team budget and current-user data. MTD aggregation follows every active project's status response and budget-duration metadata, without employee or project special cases. */
async function fetchBudgetData(team: string, identity: string): Promise<BudgetState | null> {
  try {
    const status = await governanceGet(`/project/status/${encodeURIComponent(team)}`) as { resources?: { llmTeam?: { data?: { team_info?: Record<string, unknown>; team_memberships?: unknown[] } } } } | null;
    const teamInfo = status?.resources?.llmTeam?.data?.team_info;
    if (!teamInfo || typeof teamInfo.spend !== "number" || typeof teamInfo.max_budget !== "number") {
      return null;
    }

    const mtdSpend = await fetchMtdSpend(identity);
    if (mtdSpend === null) return null;
    const state: BudgetState = {
      spend: teamInfo.spend,
      maxBudget: teamInfo.max_budget,
      youSpend: null,
      youMaxBudget: null,
      mtdSpend,
    };

    const memberships = status?.resources?.llmTeam?.data?.team_memberships;
    if (Array.isArray(memberships)) {
      const membership = memberships.find((entry: unknown) => {
        const e = entry as Record<string, unknown>;
        return e?.user_id === identity;
      });
      if (membership) {
        const m = membership as Record<string, unknown>;
        state.youSpend = typeof m.spend === "number" ? m.spend : null;
        const maxBudget = (m.litellm_budget_table as Record<string, unknown> | undefined)?.max_budget;
        state.youMaxBudget = typeof maxBudget === "number" ? maxBudget : null;
      }
    }
    return state;
  } catch {
    return null;
  }
}

// Format helpers
function fmt(n: number): string {
  return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`;
}
function money(n: number | null): string {
  return n == null ? "?" : `$${n.toFixed(2)}`;
}
function renderBar(p: number, width = 10): string {
  const filled = Math.min(width, Math.round(p * width));
  return "█".repeat(filled) + "░".repeat(width - filled);
}
function colorFor(p: number): "error" | "warning" | "success" {
  return p >= 0.9 ? "error" : p >= 0.7 ? "warning" : "success";
}

export default function (omp: ExtensionAPI) {
  console.error("[TI] Registering ti-litellm provider for OMP");
  
  omp.registerProvider("ti-litellm", {
    baseUrl: process.env.TI_BASE_URL || DEFAULT_BASE_URL,
    api: "anthropic-messages",
    headers: { "x-litellm-team-id": teamId() },
    models: [
      { id: "claude-sonnet-5-5",       name: "Claude Sonnet 5.5(1M)",  reasoning: true,  input: ["text", "image"], contextWindow: 1000000, maxTokens: 128000, cost: { input: 0.0000022, output: 0.000011, cacheRead: 0, cacheWrite: 0 } },
      { id: "claude-haiku-4-5",      name: "Claude Haiku 4.5",      reasoning: true,  input: ["text", "image"], contextWindow: 200000,  maxTokens: 64000,  cost: { input: 0.0000011, output: 0.0000055, cacheRead: 0, cacheWrite: 0 } },
      { id: "nvidia/Nemotron-3-Ultra", name: "Nemotron 3 Ultra",  reasoning: true, input: ["text"],          contextWindow: 1000000, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "nvidia/nemotron-3-super", name: "Nemotron 3 Super",    reasoning: false, input: ["text"],          contextWindow: 262144,  maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "thinkingmachines/Inkling",  name: "Inkling",           reasoning: false, input: ["text"],          contextWindow: 1000000, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "meta-models/Muse-Glimmer-30B", name: "Muse Glimmer 30B",       reasoning: false, input: ["text", "image"],          contextWindow: 131072, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "openai/gpt-oss-120b",          name: "GPT-OSS 120B",           reasoning: true,  input: ["text"],          contextWindow: 131072, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "google/gemma-4-26B-A4B-it",    name: "Gemma 4 (26B MoE)",      reasoning: false, input: ["text", "image"], contextWindow: 262144, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
      { id: "meta-llama/Llama-3.3-70B-Instruct", name: "Llama 3.3 70B",     reasoning: false, input: ["text"],          contextWindow: 131072, maxTokens: 32768, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
    ],
    oauth: {
      name: "TI LiteLLM (Kerberos)",
      async login(_callbacks: unknown) { return fetchTiCredentials(); },
      async refreshToken(_cred: unknown) { return fetchTiCredentials(); },
      getApiKey(cred: unknown) { return (cred as { access: string }).access; },
    },
  });
  
  // Register commands
  omp.registerCommand("models", {
    description: "Select a model available through TI LiteLLM",
    async handler(_args: string, ctx: unknown) {
      const modelRegistry = (ctx as { modelRegistry: { getAvailable: () => unknown[] } }).modelRegistry;
      const models = modelRegistry.getAvailable().filter((model: unknown) => (model as { provider?: string }).provider === "ti-litellm");
      if (models.length === 0) {
        (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify("No TI LiteLLM models are available. Run /login ti-litellm.", "warning");
        return;
      }
      const choices = models.map((model: unknown) => `${(model as { id: string }).id} - ${(model as { name: string }).name}`);
      const selected = await (ctx as { ui: { select: (title: string, options: string[]) => Promise<string | undefined> } }).ui.select("TI LiteLLM Models", choices);
      if (selected === undefined) return;
      const model = models[choices.indexOf(selected)];
      if (model && !(await omp.setModel(model))) {
        (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify(`Authentication is unavailable for ${(model as { id: string }).id}.`, "warning");
      }
    },
  });
  
  omp.registerCommand("set-team", {
    description: "Persist the TI LiteLLM team used by Pi",
    async handler(args: string, ctx: unknown) {
      let selected = args.trim();
      if (!selected) {
        const listed = spawnSync(NODE_BIN, [INSTALLER_CLI, "--list-teams"], {
          encoding: "utf8",
          timeout: 45000,
          stdio: ["ignore", "pipe", "pipe"],
          env: { ...process.env },
        });
        if (listed.error || listed.status !== 0) {
          (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify(`Could not list eligible teams: ${(listed.stderr || "").trim() || listed.error?.message || "unknown error"}`, "error");
          return;
        }
        let teams: string[];
        try {
          teams = JSON.parse(listed.stdout.trim());
        } catch {
          (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify("Could not parse the eligible team list.", "error");
          return;
        }
        if (!Array.isArray(teams) || teams.length === 0) {
          (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify("No active AI Governance teams are available.", "warning");
          return;
        }
        try {
          const choice = await (ctx as { ui: { select: (title: string, options: string[]) => Promise<string | undefined> } }).ui.select("Select TI LiteLLM Team", teams);
          if (choice === undefined) return;
          selected = choice;
        } catch (error) {
          (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify(`Could not select a Pi team: ${error instanceof Error ? error.message : String(error)}`, "error");
          return;
        }
      }
      const changed = spawnSync(NODE_BIN, [INSTALLER_CLI, "--set-team", selected], {
        encoding: "utf8",
        timeout: 60000,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });
      if (changed.error || changed.status !== 0) {
        (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify((changed.stderr || "").trim() || changed.error?.message || "Could not set Pi team.", "error");
        return;
      }
      (ctx as { ui: { notify: (msg: string, type: string) => void } }).ui.notify(`Pi team set to ${selected}. Reloading OMP to apply.`, "info");
      await (ctx as { reload: () => Promise<void> }).reload();
    },
  });
  
  omp.registerCommand("exit", {
    description: "Exit OMP cleanly",
    async handler(_args: string, ctx: unknown) {
      (ctx as { shutdown: () => void }).shutdown();
    },
  });

  // ---- TI Statusline (Budget / MTD Spend) ----
  // Set TI_STATUSLINE=0 (or "false") to disable; the LLM provider above is unaffected either way.
  if (process.env.TI_STATUSLINE !== "0" && process.env.TI_STATUSLINE !== "false") {
    interface StatuslineSession {
      ctx: ExtensionContext;
      refreshHandle?: ReturnType<typeof setInterval>;
    }
    let activeSession: StatuslineSession | undefined;

    omp.on("session_shutdown", async () => {
      clearInterval(activeSession?.refreshHandle);
      activeSession = undefined;
    });

    omp.on("session_start", async (_event: unknown, ctx: ExtensionContext) => {
      clearInterval(activeSession?.refreshHandle);
      const session: StatuslineSession = { ctx };
      activeSession = session;
      const team = teamId();

      // Async prefetch: setStatus must stay synchronous. Identity discovery and
      // Governance calls run only in the refresh path. A stale cache remains
      // visible until a successful refresh replaces it; fresh cache waits for
      // the next 60-second tick.
      const cached = loadCachedBudget(team);
      let budgetState: BudgetState = cached?.state || EMPTY_BUDGET_STATE;
      let refreshInFlight = false;

      // Identity is fixed for the life of the session: one Kerberos round-trip,
      // not one per 60-second budget refresh. A failed lookup is not cached so
      // a later kinit is picked up on the next tick.
      let cachedIdentity: string | null = null;
      async function sessionIdentity(): Promise<string> {
        if (!cachedIdentity) cachedIdentity = await currentIdentity();
        return cachedIdentity || os.userInfo().username;
      }

      async function refreshBudget() {
        if (refreshInFlight) return;
        refreshInFlight = true;
        try {
          const identity = await sessionIdentity();
          const fresh = await fetchBudgetData(team, identity);
          if (fresh !== null) {
            budgetState = fresh;
            saveCachedBudget(team, fresh);
            renderBudgetStatus();
          }
        } finally {
          refreshInFlight = false;
        }
      }
      if (!cached?.fresh) void refreshBudget();
      session.refreshHandle = setInterval(refreshBudget, BUDGET_CACHE_TTL_MS);

      function renderBudgetStatus() {
        const budgetPct = budgetState.maxBudget ? (budgetState.spend || 0) / budgetState.maxBudget : 0;
        const budgetStr = `[${renderBar(budgetPct)}] ${money(budgetState.spend)}/${money(budgetState.maxBudget)}`;

        let parts: string[] = [`Budget ${budgetStr}`];

        if (budgetState.youMaxBudget != null) {
          const youPct = budgetState.youMaxBudget ? (budgetState.youSpend || 0) / budgetState.youMaxBudget : 0;
          const youStr = `[${renderBar(youPct)}] ${money(budgetState.youSpend)}/${money(budgetState.youMaxBudget)}`;
          parts.push(`You ${youStr}`);
        }
        parts.push(`MTD: ${money(budgetState.mtdSpend)}`);
        parts.push(`Team: ${teamDisplayName()}`);

        ctx.ui.setStatus("ti-budget", parts.join(" | "));
      }

      // Initial render
      renderBudgetStatus();

      // Cleanup on session end
      const originalShutdown = session.ctx.shutdown;
      session.ctx.shutdown = async () => {
        clearInterval(session.refreshHandle);
        ctx.ui.setStatus("ti-budget", undefined);
        return originalShutdown.call(session.ctx);
      };
    });
  }
}
