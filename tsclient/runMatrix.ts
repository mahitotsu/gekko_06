// Trigger × ServerBehavior のフルマトリクスを、同一の手順(runScenario.ts)で
// 逐次実行する。「検証対象以外の条件を揃える」ことを、個々のシナリオ実装ではなく
// このオーケストレーション層で保証する。
//
// usage: npx tsx runMatrix.ts [--only=trigger1,trigger2] [--skip-behaviors=ignore-signals-and-eof] [--repeats=N] [--start-rep=N]
// --repeats=N を指定すると、全マトリクスをN回繰り返し、各セルの結果を
// __rep1..__repN のファイル名で個別に保存する(平均・中央値の算出用)。
// --start-rep=N はrepの開始番号(デフォルト1)。既存のrepを壊さず追加実行したい場合に使う。
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ALL_BEHAVIORS, ALL_TRIGGERS, type Trigger, type ServerBehavior } from "./src/types";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function parseListArg(name: string): string[] | null {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return null;
  return arg.split("=")[1].split(",");
}

function parseIntArg(name: string, fallback: number): number {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return fallback;
  return Number(arg.split("=")[1]);
}

async function main() {
  const onlyTriggers = parseListArg("only") as Trigger[] | null;
  const skipBehaviors = parseListArg("skip-behaviors") as ServerBehavior[] | null;
  const repeats = parseIntArg("repeats", 1);
  const startRep = parseIntArg("start-rep", 1);

  const triggers = onlyTriggers ?? ALL_TRIGGERS;
  const behaviors = ALL_BEHAVIORS.filter((b) => !skipBehaviors?.includes(b));

  const cells: Array<{ trigger: Trigger; behavior: ServerBehavior }> = [];
  for (const trigger of triggers) {
    for (const behavior of behaviors) {
      cells.push({ trigger, behavior });
    }
  }

  const reps = Array.from({ length: repeats }, (_, i) => startRep + i);
  const totalRuns = cells.length * reps.length;
  console.log(
    `running ${cells.length} scenarios × ${reps.length} reps = ${totalRuns} runs: ${cells
      .map((c) => `${c.trigger}×${c.behavior}`)
      .join(", ")}`
  );

  let done = 0;
  const startedAt = Date.now();
  for (const rep of reps) {
    for (const cell of cells) {
      done++;
      const elapsedMin = ((Date.now() - startedAt) / 60000).toFixed(1);
      console.log(`\n=== [${done}/${totalRuns}] rep${rep} ${cell.trigger} × ${cell.behavior} (elapsed ${elapsedMin}min) ===`);
      const args = ["tsx", "runScenario.ts", `--trigger=${cell.trigger}`, `--behavior=${cell.behavior}`];
      if (repeats > 1 || startRep !== 1) args.push(`--rep=${rep}`);
      try {
        const out = execFileSync("npx", args, {
          cwd: __dirname,
          encoding: "utf8",
          stdio: "pipe",
          timeout: 130_000,
        });
        console.log(out.trim().split("\n").slice(-3).join("\n"));
      } catch (err: any) {
        console.error(`FAILED: rep${rep} ${cell.trigger}×${cell.behavior}: ${err.message}`);
      }
    }
  }

  const totalMin = ((Date.now() - startedAt) / 60000).toFixed(1);
  console.log(`\nmatrix run complete (${totalMin} min total). see results/*.json, then run: npx tsx aggregateResults.ts`);
}

main();
