// results/*.json (runMatrix.tsの出力) から、決定表を機械的に生成する。
// 手書きの表と実測値が食い違うことがないようにするための唯一の生成経路。
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { ScenarioResult } from "./src/types";
import { RESULTS_DIR, REPO_ROOT } from "./src/constants";

function fmtMs(ms: number | null): string {
  if (ms === null) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

function main() {
  const files = readdirSync(RESULTS_DIR).filter((f) => f.endsWith(".json") && f !== "topology.json");
  const results: ScenarioResult[] = files.map((f) => JSON.parse(readFileSync(path.join(RESULTS_DIR, f), "utf8")));
  results.sort((a, b) => (a.trigger + a.behavior).localeCompare(b.trigger + b.behavior));

  const rows = results.map((r) => {
    const serverStatus = r.server.diedAtMs !== null ? `死亡 (+${fmtMs(r.server.diedAtMs)})` : `生存(観測終了時点)`;
    const cliStatus =
      r.cli.pid === null
        ? "n/a(CLI特定失敗)"
        : r.cli.diedAtMs !== null
          ? `死亡 (+${fmtMs(r.cli.diedAtMs)})`
          : `生存(観測終了時点)`;
    const notes = r.notes.length ? ` ⚠️${r.notes.join("; ")}` : "";
    return `| ${r.trigger} | ${r.behavior} | ${serverStatus} | ${cliStatus} |${notes}`;
  });

  const table = [
    "| trigger | behavior | server(MCPサーバー) | cli(claudeプロセス) |",
    "|---|---|---|---|",
    ...rows,
  ].join("\n");

  console.log(table);

  const topologyPath = path.join(RESULTS_DIR, "topology.json");
  if (existsSync(topologyPath)) {
    console.log("\n--- topology.json ---");
    console.log(readFileSync(topologyPath, "utf8"));
  }

  writeFileSync(path.join(REPO_ROOT, "results", "matrix-table.md"), table + "\n");
}

main();
