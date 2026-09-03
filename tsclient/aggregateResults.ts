// results/*__rep*.json を (trigger, behavior) ごとに集計し、
// 平均・中央値・標準偏差・最小/最大・サンプル数を算出する。
// 単発実行(repなし)の結果ファイルは対象外(統計を取るための繰り返し実行専用)。
//
// usage: npx tsx aggregateResults.ts
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { ScenarioResult, Trigger, ServerBehavior } from "./src/types";
import { RESULTS_DIR, REPO_ROOT } from "./src/constants";

interface Stats {
  n: number;
  mean: number | null;
  median: number | null;
  min: number | null;
  max: number | null;
  stddev: number | null;
  /** diedAtMsがnull(=観測窓の終わりまで生存)だったサンプル数。 */
  neverDiedCount: number;
}

function computeStats(values: number[], neverDiedCount: number): Stats {
  const n = values.length;
  if (n === 0) {
    return { n: 0, mean: null, median: null, min: null, max: null, stddev: null, neverDiedCount };
  }
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const median =
    n % 2 === 1 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  const variance = n > 1 ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1) : 0;
  const stddev = Math.sqrt(variance);
  return { n, mean, median, min: sorted[0], max: sorted[n - 1], stddev, neverDiedCount };
}

function fmt(ms: number | null): string {
  return ms === null ? "—" : `${(ms / 1000).toFixed(2)}s`;
}

function main() {
  const files = readdirSync(RESULTS_DIR).filter((f) => /__rep\d+\.json$/.test(f));
  console.log(`found ${files.length} repeated-run result files`);

  type Key = string; // `${trigger}__${behavior}`
  const groups = new Map<Key, ScenarioResult[]>();
  for (const f of files) {
    const r: ScenarioResult = JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8"));
    const key = `${r.trigger}__${r.behavior}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(r);
  }

  const summary: Array<{
    trigger: Trigger;
    behavior: ServerBehavior;
    server: Stats | null;
    cli: Stats | null;
  }> = [];

  for (const [key, results] of [...groups.entries()].sort()) {
    const [trigger, behavior] = key.split("__") as [Trigger, ServerBehavior];

    // server.pidがnullなのは、SERVER_READY_TIMEOUT_MS以内にPIDファイルを検出できなかった
    // 実行のみ(サーバー自体は起動していても検出が間に合わなかっただけの場合を含む)。
    // 生死追跡自体が成立していないので、cliと同様にサンプルから除外する。
    const serverFound = results.filter((r) => r.server.pid !== null);
    const serverDied = serverFound.map((r) => r.server.diedAtMs).filter((v): v is number => v !== null);
    const serverNeverDied = serverFound.filter((r) => r.server.diedAtMs === null).length;
    const serverStats: Stats | null = serverFound.length > 0 ? computeStats(serverDied, serverNeverDied) : null;
    if (serverFound.length < results.length) {
      console.log(`  note: ${trigger}×${behavior} — サーバーPID未特定のため${results.length - serverFound.length}件をserver統計から除外`);
    }

    // cli.pidがnullなのは、work_started時点でCLI候補が1つに定まらなかった実行のみ。
    // そうした回はサンプルから除外する(死んだとも生きているとも言えないため)。
    const cliFound = results.filter((r) => r.cli.pid !== null);
    const cliDied = cliFound.map((r) => r.cli.diedAtMs).filter((v): v is number => v !== null);
    const cliNeverDied = cliFound.filter((r) => r.cli.diedAtMs === null).length;
    const cliStats: Stats | null = cliFound.length > 0 ? computeStats(cliDied, cliNeverDied) : null;
    if (cliFound.length < results.length) {
      console.log(`  note: ${trigger}×${behavior} — CLI PID未特定のため${results.length - cliFound.length}件をcli統計から除外`);
    }

    summary.push({ trigger, behavior, server: serverStats, cli: cliStats });
  }

  const rows = summary.map((s) => {
    const serverCell = s.server
      ? `n=${s.server.n} 平均${fmt(s.server.mean)} 中央値${fmt(s.server.median)} (${fmt(s.server.min)}〜${fmt(s.server.max)}) σ=${fmt(s.server.stddev)}${s.server.neverDiedCount ? ` ⚠️生存${s.server.neverDiedCount}件` : ""}`
      : "n/a";
    const cliCell = s.cli
      ? `n=${s.cli.n} 平均${fmt(s.cli.mean)} 中央値${fmt(s.cli.median)} (${fmt(s.cli.min)}〜${fmt(s.cli.max)}) σ=${fmt(s.cli.stddev)}${s.cli.neverDiedCount ? ` ⚠️生存${s.cli.neverDiedCount}件` : ""}`
      : "n/a";
    return `| ${s.trigger} | ${s.behavior} | ${serverCell} | ${cliCell} |`;
  });

  const table = [
    "| trigger | behavior | server(MCPサーバー) | cli(claudeプロセス) |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");

  console.log("\n" + table);

  writeFileSync(path.join(RESULTS_DIR, "aggregate.json"), JSON.stringify(summary, null, 2));
  writeFileSync(path.join(REPO_ROOT, "results", "aggregate-table.md"), table + "\n");
  console.log(`\nwrote results/aggregate.json and results/aggregate-table.md`);
}

main();
