import { homedir } from "node:os";
import { relative, isAbsolute, sep } from "node:path";
import type { Usage } from "@earendil-works/pi-ai";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const contextTokens = (n: number) => n < 1000 ? String(Math.round(n))
  : n < 1000000 ? `${Math.round(n / 1000)}K`
  : `${Number((n / 1000000).toFixed(1))}M`;
const compact = (n: number) => n < 1000 ? String(n)
  : n < 10000 ? `${(n / 1000).toFixed(1)}k`
  : n < 1000000 ? `${Math.round(n / 1000)}k` : `${(n / 1000000).toFixed(1)}M`;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    if (ctx.mode !== "tui") return;
    ctx.ui.setFooter((tui, theme, footerData) => {
      const unsubscribe = footerData.onBranchChange(() => tui.requestRender());
      let lastLeaf: string | null | undefined;
      let lastCount = -1;
      let totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
      let cacheHit: number | undefined;

      return {
        dispose: unsubscribe,
        invalidate() {},
        render(width: number): string[] {
          const entries = ctx.sessionManager.getEntries();
          const leaf = ctx.sessionManager.getLeafId();
          if (leaf !== lastLeaf || entries.length !== lastCount) {
            lastLeaf = leaf;
            lastCount = entries.length;
            totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
            cacheHit = undefined;
            const add = (usage: Usage) => {
              for (const key of ["input", "output", "cacheRead", "cacheWrite"] as const)
                totals[key] += usage[key];
              totals.cost += usage.cost.total;
            };
            for (const entry of entries) {
              if (entry.type === "usage") add(entry.usage);
              else if (entry.type === "message" && entry.message.role === "assistant") {
                const usage = entry.message.usage;
                add(usage);
                const prompt = usage.input + usage.cacheRead + usage.cacheWrite;
                cacheHit = prompt > 0 ? usage.cacheRead / prompt * 100 : undefined;
              } else if (entry.type === "message" && entry.message.role === "toolResult" && entry.message.usage)
                add(entry.message.usage);
              else if ((entry.type === "compaction" || entry.type === "branch_summary") && entry.usage)
                add(entry.usage);
            }
          }

          const usage = ctx.getContextUsage();
          const limit = usage?.contextWindow ?? ctx.model?.contextWindow ?? 0;
          const context = `${usage?.tokens == null ? "?" : contextTokens(usage.tokens)}/${contextTokens(limit)}`;
          const percent = usage?.percent ?? 0;
          const parts: string[] = [];
          for (const [key, prefix] of [["input", "↑"], ["output", "↓"], ["cacheRead", "R"], ["cacheWrite", "W"]] as const)
            if (totals[key]) parts.push(`${prefix}${compact(totals[key])}`);
          if ((totals.cacheRead || totals.cacheWrite) && cacheHit !== undefined)
            parts.push(`CH${cacheHit.toFixed(1)}%`);
          const subscription = ctx.model && (ctx.model.provider === "kimi-coding" || ctx.modelRegistry.isUsingOAuth(ctx.model));
          if (totals.cost || subscription) parts.push(`$${totals.cost.toFixed(3)}${subscription ? " (sub)" : ""}`);
          parts.push(percent > 90 ? theme.fg("error", context) : percent > 70 ? theme.fg("warning", context) : context);
          const left = parts.join(" ");
          const model = ctx.model;
          const provider = model && footerData.getAvailableProviderCount() > 1 ? `(${model.provider}) ` : "";
          const right = `${provider}${model?.id ?? "no-model"}${model?.reasoning ? ` • ${pi.getThinkingLevel()}` : ""}`;
          const remaining = width - visibleWidth(left) - 2;
          const rightText = remaining > 0 ? truncateToWidth(right, remaining, "") : "";
          const padding = " ".repeat(Math.max(0, width - visibleWidth(left) - visibleWidth(rightText)));

          const cwd = ctx.sessionManager.getCwd();
          const rel = relative(homedir(), cwd);
          const path = rel === "" ? "~" : rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel) ? `~${sep}${rel}` : cwd;
          const branch = footerData.getGitBranch();
          const name = ctx.sessionManager.getSessionName();
          const lines = [
            truncateToWidth(theme.fg("dim", `${path}${branch ? ` (${branch})` : ""}${name ? ` • ${name}` : ""}`), width),
            truncateToWidth(theme.fg("dim", left) + theme.fg("dim", padding + rightText), width),
          ];
          const statuses = [...footerData.getExtensionStatuses()].sort(([a], [b]) => a.localeCompare(b))
            .map(([, value]) => value.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim());
          if (statuses.length) lines.push(truncateToWidth(theme.fg("dim", statuses.join(" ")), width));
          return lines;
        },
      };
    });
  });
}
