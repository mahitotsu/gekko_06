// Trigger × ServerBehavior のフルマトリクスを、同一の手順(runScenario.ts)で
// 逐次実行する。「検証対象以外の条件を揃える」ことを、個々のシナリオ実装ではなく
// このオーケストレーション層で保証する。
//
// usage: npx tsx runMatrix.ts [--only=trigger1,trigger2] [--skip-behaviors=ignore-signals-and-eof]
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

async function main() {
  const onlyTriggers = parseListArg("only") as Trigger[] | null;
  const skipBehaviors = parseListArg("skip-behaviors") as ServerBehavior[] | null;

  const triggers = onlyTriggers ?? ALL_TRIGGERS;
  const behaviors = ALL_BEHAVIORS.filter((b) => !skipBehaviors?.includes(b));

  const cells: Array<{ trigger: Trigger; behavior: ServerBehavior }> = [];
  for (const trigger of triggers) {
    for (const behavior of behaviors) {
      cells.push({ trigger, behavior });
    }
  }

  console.log(`running ${cells.length} scenarios: ${cells.map((c) => `${c.trigger}×${c.behavior}`).join(", ")}`);

  for (const [i, cell] of cells.entries()) {
    console.log(`\n=== [${i + 1}/${cells.length}] ${cell.trigger} × ${cell.behavior} ===`);
    try {
      const out = execFileSync("npx", ["tsx", "runScenario.ts", `--trigger=${cell.trigger}`, `--behavior=${cell.behavior}`], {
        cwd: __dirname,
        encoding: "utf8",
        stdio: "pipe",
        timeout: 130_000,
      });
      console.log(out.trim().split("\n").slice(-3).join("\n"));
    } catch (err: any) {
      console.error(`FAILED: ${cell.trigger}×${cell.behavior}: ${err.message}`);
    }
  }

  console.log("\nmatrix run complete. see results/*.json, then run: npx tsx renderMatrix.ts");
}

main();
