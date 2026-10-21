import type { Plugin } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin";
import fs from "node:fs";
import path from "node:path";

/**
 * loop-guard — Session handoff support (xem .agent/session-handoff.md).
 *
 * Cung cấp:
 *  - tool `usage()`: đo context occupancy của session hiện tại.
 *  - toast cảnh báo khi vượt hard threshold.
 *  - inject nhắc "re-read journal" vào prompt compaction.
 *
 * Plugin phải defensive: mọi lỗi runtime được nuốt để không làm hỏng session.
 */

type Policy = {
  usageGate: {
    enabled: boolean;
    threshold: number;
    minStepsLeft: number;
    hardThreshold: number;
  };
};

const DEFAULT_POLICY: Policy = {
  usageGate: { enabled: true, threshold: 0.35, minStepsLeft: 2, hardThreshold: 0.75 },
};

function readPolicy(directory: string): Policy {
  try {
    const raw = fs.readFileSync(path.join(directory, ".context", "session-policy.json"), "utf8");
    const parsed = JSON.parse(raw) as Partial<Policy>;
    const g: Partial<Policy["usageGate"]> = parsed.usageGate ?? {};
    return {
      usageGate: {
        enabled: g.enabled ?? DEFAULT_POLICY.usageGate.enabled,
        threshold: g.threshold ?? DEFAULT_POLICY.usageGate.threshold,
        minStepsLeft: g.minStepsLeft ?? DEFAULT_POLICY.usageGate.minStepsLeft,
        hardThreshold: g.hardThreshold ?? DEFAULT_POLICY.usageGate.hardThreshold,
      },
    };
  } catch {
    return DEFAULT_POLICY;
  }
}

type Usage = {
  occupancy: number;
  limit: number;
  percent: number | null;
  cost: number;
};

export default (async ({ client, directory }) => {
  const warned = new Map<string, boolean>();

  async function computeUsage(sessionID: string): Promise<Usage | null> {
    const res: any = await client.session.messages({ path: { id: sessionID } });
    const list: any[] = res?.data ?? [];
    let last: any = null;
    let fallback: any = null;
    for (let i = list.length - 1; i >= 0; i--) {
      const info = list[i]?.info;
      if (info?.role !== "assistant" || !info?.tokens) continue;
      if (!fallback) fallback = info;
      const t0 = info.tokens;
      const occ =
        (t0.input ?? 0) + (t0.output ?? 0) + (t0.reasoning ?? 0) + (t0.cache?.read ?? 0) + (t0.cache?.write ?? 0);
      // Bỏ qua message đang sinh (tokens chưa ghi = occupancy 0) → lấy message hoàn tất gần nhất.
      if (occ > 0) {
        last = info;
        break;
      }
    }
    if (!last) last = fallback;
    if (!last) return null;

    const t = last.tokens ?? {};
    const occupancy =
      (t.input ?? 0) + (t.output ?? 0) + (t.reasoning ?? 0) + (t.cache?.read ?? 0) + (t.cache?.write ?? 0);

    let limit = 0;
    try {
      const prov: any = await client.config.providers();
      const p = (prov?.data?.providers ?? []).find((x: any) => x.id === last.providerID);
      limit = p?.models?.[last.modelID]?.limit?.context ?? 0;
    } catch {
      limit = 0;
    }

    return {
      occupancy,
      limit,
      percent: limit > 0 ? occupancy / limit : null,
      cost: typeof last.cost === "number" ? last.cost : 0,
    };
  }

  function fmt(u: Usage, g: Policy["usageGate"]): string {
    const pct = u.percent === null ? "?" : `${(u.percent * 100).toFixed(1)}%`;
    const over = u.percent !== null && g.enabled && u.percent >= g.threshold;
    const hard = u.percent !== null && g.enabled && u.percent >= g.hardThreshold;
    return [
      `occupancy=${u.occupancy}`,
      `limit=${u.limit || "?"}`,
      `percent=${pct}`,
      `cost=$${u.cost.toFixed(4)}`,
      `gate(enabled=${g.enabled}, threshold=${g.threshold}, minStepsLeft=${g.minStepsLeft}, hard=${g.hardThreshold})`,
      `over=${over}`,
      `hard=${hard}`,
    ].join(" ");
  }

  return {
    tool: {
      usage: tool({
        description:
          "Đo context usage của session hiện tại (occupancy/limit/percent/cost) để quyết định safe-point dừng session. Gọi ở mỗi checkpoint khi session-policy bật usageGate.",
        args: {},
        async execute(_args, ctx) {
          try {
            const u = await computeUsage(ctx.sessionID);
            if (!u) return "usage: không tìm thấy assistant message có tokens.";
            return `usage: ${fmt(u, readPolicy(ctx.directory).usageGate)}`;
          } catch (e) {
            return `usage: unavailable (${(e as Error).message})`;
          }
        },
      }),
    },

    "tool.execute.after": async (input) => {
      if (input.tool !== "task") return;
      try {
        const g = readPolicy(directory).usageGate;
        if (!g.enabled) return;
        const u = await computeUsage(input.sessionID);
        if (!u || u.percent === null) return;
        if (u.percent >= g.hardThreshold && !warned.get(input.sessionID)) {
          warned.set(input.sessionID, true);
          await client.tui.showToast({
            body: {
              title: "session-handoff",
              message: `Context ${(u.percent * 100).toFixed(0)}% ≥ hard ${(g.hardThreshold * 100).toFixed(0)}% — nên dừng ở safe-point kế tiếp`,
              variant: "warning",
            },
          });
        }
      } catch {
        // defensive: never break the session
      }
    },

    "experimental.session.compacting": async (_input, output) => {
      try {
        output.context.push(
          [
            "## Session handoff (bắt buộc)",
            "Sau compact PHẢI re-read Run Journal `.context/runs/<type>-<slug>-<phaseTask>.md` từ đĩa",
            "trước khi tiếp tục — đĩa là sự thật, pointer (`progress.json`) chỉ là hint.",
            "Xem `.agent/session-handoff.md` (write-ahead checkpoint, redo policy) + resume matrix ở `.agent/FEATURE_WORKFLOW.md`.",
          ].join("\n"),
        );
      } catch {
        // defensive
      }
    },
  };
}) satisfies Plugin;
