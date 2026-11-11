import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const NODE_BIN = "/home/a0507112/.nvm/versions/node/v22.21.0/bin/node";
const TOKEN_SCRIPT =
    "/home/a0507112/.nvm/versions/node/v22.21.0/lib/node_modules/ti-pi-harness-install/lib/get-token.js";
const TI_CA_BUNDLE = "/home/a0507112/.local/certs/ti-ca-bundle.pem";
const TEAM = process.env.TI_LITELLM_TEAM_ID || "DAP_PE_EPD_PROC_SW";
const GOVERNANCE = "https://ai-governance-backend.lecomcpprod.itg.ti.com";
const REFRESH_MS = 60_000;
const TICK_MS = 2_000;

type Budget = { left: number; max: number };
type CachedBudget = { team: string; budget: Budget; savedAt: number };

function runJson(
    command: string,
    args: string[],
    timeoutMs: number,
    env?: NodeJS.ProcessEnv,
): Promise<any> {
    return new Promise((resolve) => {
        let stdout = "";
        let settled = false;
        const finish = (value: any) => {
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
            return finish(null);
        }
        const timer = setTimeout(() => {
            child.kill();
            finish(null);
        }, timeoutMs);
        child.stdout?.on("data", (chunk) => {
            stdout += chunk;
        });
        child.on("error", () => {
            clearTimeout(timer);
            finish(null);
        });
        child.on("close", (code) => {
            clearTimeout(timer);
            if (code !== 0) return finish(null);
            try {
                finish(JSON.parse(stdout));
            } catch {
                finish(null);
            }
        });
    });
}

function tokenEnv(team: string): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...process.env, TI_LITELLM_TEAM_ID: team };
    if (!env.NODE_EXTRA_CA_CERTS && fs.existsSync(TI_CA_BUNDLE))
        env.NODE_EXTRA_CA_CERTS = TI_CA_BUNDLE;
    return env;
}

function identityFromToken(token: string): string | null {
    try {
        const payload = JSON.parse(
            Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
        );
        const identity = payload?.preferred_username || payload?.sub;
        return typeof identity === "string" && identity ? identity : null;
    } catch {
        return null;
    }
}

async function currentIdentity(): Promise<string> {
    const response = await runJson(
        NODE_BIN,
        [TOKEN_SCRIPT, "--json"],
        35_000,
        tokenEnv(""),
    );
    return (
        identityFromToken(response?.access_token ?? "") ??
        os.userInfo().username
    );
}

function governanceGet(urlPath: string): Promise<any> {
    return runJson(
        "curl",
        [
            "-s",
            "-f",
            "--connect-timeout",
            "3",
            "--max-time",
            "5",
            "--noproxy",
            ".itg.ti.com",
            `${GOVERNANCE}${urlPath}`,
        ],
        6_000,
    );
}

async function fetchPersonalBudget(identity: string): Promise<Budget | null> {
    const status = await governanceGet(
        `/project/status/${encodeURIComponent(TEAM)}`,
    );
    const memberships = status?.resources?.llmTeam?.data?.team_memberships;
    if (!Array.isArray(memberships)) return null;
    const membership = memberships.find(
        (entry: any) => entry?.user_id === identity,
    );
    const max = membership?.litellm_budget_table?.max_budget;
    const spend = membership?.spend;
    if (typeof max !== "number" || typeof spend !== "number") return null;
    return { left: max - spend, max };
}

const CACHE_PATH = path.join(
    process.env.XDG_STATE_HOME || path.join(os.homedir(), ".local", "state"),
    "opencode",
    "ti-status-budget.json",
);

function loadCachedBudget(): { budget: Budget; fresh: boolean } | null {
    try {
        const raw = JSON.parse(
            fs.readFileSync(CACHE_PATH, "utf8"),
        ) as CachedBudget;
        if (raw.team !== TEAM || typeof raw.savedAt !== "number") return null;
        return {
            budget: raw.budget,
            fresh: Date.now() - raw.savedAt <= REFRESH_MS,
        };
    } catch {
        return null;
    }
}

function saveCachedBudget(budget: Budget) {
    try {
        fs.mkdirSync(path.dirname(CACHE_PATH), { recursive: true });
        const entry: CachedBudget = { team: TEAM, budget, savedAt: Date.now() };
        fs.writeFileSync(CACHE_PATH, JSON.stringify(entry), "utf8");
    } catch {
        // best-effort cache
    }
}

function fmtTokens(n: number): string {
    return n < 1000 ? `${n}` : `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
}

function amount(n: number): string {
    return `$${Number.isInteger(n) ? n : n.toFixed(2)}`;
}

function contextColor(pct: number): string {
    if (pct >= 0.9) return "#fb7185";
    if (pct >= 0.7) return "#fbbf24";
    return "#34d399";
}

function budgetColor(left: number, max: number): string {
    const pct = max > 0 ? left / max : 0;
    if (pct < 0.1) return "#fb7185";
    if (pct < 0.3) return "#fbbf24";
    return "#34d399";
}

export default Plugin.define({
    id: "raaghav.ti-status.tui",
    setup(context) {
        const [budget, setBudget] = createSignal<Budget | undefined>(
            loadCachedBudget()?.budget,
        );
        const [tick, setTick] = createSignal(0);
        let identity: string | null = null;
        let inFlight: Promise<void> | undefined;

        const refresh = () => {
            if (inFlight) return inFlight;
            inFlight = (async () => {
                try {
                    identity ??= await currentIdentity();
                    const fresh = await fetchPersonalBudget(identity);
                    if (fresh) {
                        setBudget(fresh);
                        saveCachedBudget(fresh);
                    }
                } catch {
                    // keep last known value
                } finally {
                    inFlight = undefined;
                }
            })();
            return inFlight;
        };

        const cached = loadCachedBudget();
        if (!cached?.fresh) void refresh();
        const refreshTimer = setInterval(() => void refresh(), REFRESH_MS);

        const [usage, setUsage] = createSignal<{
            used: number;
            limit?: number;
        }>({ used: 0 });
        const [work, setWork] = createSignal<{ agents: number; shells: number }>({
            agents: 0,
            shells: 0,
        });
        let usageSession: string | undefined;

        const refreshWork = async (sessionID: string) => {
            try {
                const client: any = context.client;
                const [children, active, shells] = await Promise.all([
                    client.session.list({ parentID: sessionID }),
                    client.session.active?.(),
                    client.shell.list(),
                ]);
                const running = active?.data ?? {};
                const childList = children?.data ?? [];
                const agents = childList.filter(
                    (child: any) => running[child.id]?.type === "running",
                ).length;
                const shellList = shells?.data ?? [];
                setWork({
                    agents,
                    shells: shellList.filter(
                        (shell: any) => shell.metadata?.sessionID === sessionID,
                    ).length,
                });
            } catch {
                // keep last known value
            }
        };

        const refreshUsage = async (sessionID: string) => {
            try {
                const client: any = context.client;
                const response = await (client.message?.list ?? client.session.message.list)({
                    sessionID,
                    limit: 20,
                    order: "desc",
                });
                const messages = (response.data ?? response ?? []) as any[];
                const list = Array.isArray(messages)
                    ? messages
                    : ((messages as any).data ?? []);
                const last = list.find(
                    (message: any) => message.type === "assistant" && message.tokens,
                );
                if (!last) return;
                const used =
                    last.tokens.input +
                    (last.tokens.cache?.read ?? 0) +
                    (last.tokens.cache?.write ?? 0);
                const models = await client.model.list();
                const modelList = (models.data ?? models ?? []) as any[];
                const entries = Array.isArray(modelList)
                    ? modelList
                    : ((modelList as any).data ?? []);
                const limit = entries.find(
                    (model: any) =>
                        model.providerID === last.model.providerID &&
                        model.id === last.model.id,
                )?.limit?.context;
                setUsage({ used, limit });
            } catch {
                // keep last known value
            }
        };

        const contextFor = (sessionID: string) => {
            if (usageSession !== sessionID) {
                usageSession = sessionID;
                void refreshUsage(sessionID);
                void refreshWork(sessionID);
            }
            tick();
            return usage();
        };

        const tickTimer = setInterval(() => {
            setTick((value) => value + 1);
            if (usageSession) {
                void refreshUsage(usageSession);
                void refreshWork(usageSession);
            }
        }, TICK_MS);

        context.ui.slot({
            append: "prompt.footer",
            render(props) {
                {
                    const usage = () => contextFor(props.sessionID);
                    const contextText = () => {
                        const { used, limit } = usage();
                        return `Context ${fmtTokens(used)}/${limit ? fmtTokens(limit) : "?"}`;
                    };
                    const contextFg = () => {
                        const { used, limit } = usage();
                        return limit
                            ? contextColor(used / limit)
                            : context.theme.text.muted;
                    };
                    const budgetText = () => {
                        const current = budget();
                        return current
                            ? `Your Budget: ${amount(current.max - current.left)}/${amount(current.max)}`
                            : "Your Budget: ?";
                    };
                    const budgetFg = () => {
                        const current = budget();
                        return current
                            ? budgetColor(current.left, current.max)
                            : context.theme.text.muted;
                    };
                    const workText = () => {
                        const { agents, shells } = work();
                        return [
                            agents ? `${agents} subagent${agents === 1 ? "" : "s"}` : "",
                            shells ? `${shells} shell${shells === 1 ? "" : "s"}` : "",
                        ]
                            .filter(Boolean)
                            .join(" · ");
                    };
                    if (props.mode === "shell")
                        return (
                            <text fg={context.theme.text.muted}>
                                esc exit shell mode
                            </text>
                        );
                    return (
                        <box flexDirection="row" gap={2}>
                            {workText() ? (
                                <text fg={context.theme.text.base}>{workText()}</text>
                            ) : null}
                            <text fg={contextFg()}>{contextText()}</text>
                            <text fg={budgetFg()}>{budgetText()}</text>
                        </box>
                    );
                }
            },
        });
        return () => {
            clearInterval(refreshTimer);
            clearInterval(tickTimer);
        };
    },
});
