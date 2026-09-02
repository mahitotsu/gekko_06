// 1つの (Trigger, ServerBehavior) の組み合わせを実行する唯一のエントリポイント。
// 全シナリオが同じ手順(起動待ち→トリガー適用→固定時間の生死観測→結果書き出し)を通る。
//
// usage: npx tsx runScenario.ts --trigger=<T> --behavior=<B>
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { ALL_BEHAVIORS, ALL_TRIGGERS, type ScenarioResult, type Trigger, type ServerBehavior } from "./src/types";
import { RUN_DIR, RESULTS_DIR, OBSERVE_WINDOW_MS, SERVER_READY_TIMEOUT_MS, WORK_SECONDS } from "./src/constants";
import { waitFor, findClaudeCliPids, forceKill, isAlive, cmdlineOf } from "./src/processUtils";
import { waitForEvent, readEvents } from "./src/eventsLog";
import { trackLiveness } from "./src/liveness";

function parseArgs(): { trigger: Trigger; behavior: ServerBehavior } {
  const args = Object.fromEntries(
    process.argv.slice(2).map((a) => {
      const [k, v] = a.replace(/^--/, "").split("=");
      return [k, v];
    })
  );
  const trigger = args.trigger as Trigger;
  const behavior = args.behavior as ServerBehavior;
  if (!ALL_TRIGGERS.includes(trigger)) throw new Error(`invalid --trigger: ${args.trigger}`);
  if (!ALL_BEHAVIORS.includes(behavior)) throw new Error(`invalid --behavior: ${args.behavior}`);
  return { trigger, behavior };
}

async function main() {
  const { trigger, behavior } = parseArgs();
  const scenarioId = `${trigger}__${behavior}`;
  const scenarioDir = path.join(RUN_DIR, scenarioId);
  rmSync(scenarioDir, { recursive: true, force: true });
  mkdirSync(scenarioDir, { recursive: true });
  mkdirSync(RESULTS_DIR, { recursive: true });

  const pidFile = path.join(scenarioDir, "server.pid");
  const eventsLog = path.join(scenarioDir, "server-events.jsonl");
  const notes: string[] = [];

  console.log(`[${scenarioId}] launching inner session`);
  const child: ChildProcess = spawn("npx", ["tsx", "innerSession.ts"], {
    cwd: __dirname,
    env: {
      ...process.env,
      MCPVERIFY_TRIGGER: trigger,
      MCPVERIFY_BEHAVIOR_ARG: behavior,
      MCPVERIFY_PID_FILE: pidFile,
      MCPVERIFY_EVENTS_LOG: eventsLog,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const innerPid = child.pid!;
  let innerOut = "";
  child.stdout?.on("data", (d) => (innerOut += d.toString()));
  child.stderr?.on("data", (d) => (innerOut += d.toString()));

  const innerExited = new Promise<void>((resolve) => child.on("exit", () => resolve()));

  const serverReady = await waitFor(() => existsSync(pidFile), SERVER_READY_TIMEOUT_MS);
  if (!serverReady) {
    notes.push("server did not start within timeout");
  }
  const serverPid = serverReady ? Number(readFileSync(pidFile, "utf8").trim()) : null;
  console.log(`[${scenarioId}] server ready pid=${serverPid}`);

  let epochMs: number;
  let cliPidAtTrigger: number | null = null;

  if (trigger === "kill-cli" || trigger === "kill-node") {
    const workStarted = await waitForEvent(eventsLog, "work_started", SERVER_READY_TIMEOUT_MS + WORK_SECONDS * 1000);
    if (!workStarted) notes.push("work_started event not observed before timeout");

    const cliCandidates = findClaudeCliPids();
    if (cliCandidates.length !== 1) {
      notes.push(`expected exactly 1 claude CLI process, found ${cliCandidates.length}: [${cliCandidates.join(",")}]`);
    }
    cliPidAtTrigger = cliCandidates[0] ?? null;
    if (cliPidAtTrigger !== null) {
      console.log(`[${scenarioId}] CLI candidate pid=${cliPidAtTrigger} cmdline=${cmdlineOf(cliPidAtTrigger).slice(0, 120)}...`);
    }

    if (trigger === "kill-cli") {
      if (cliPidAtTrigger === null) {
        notes.push("could not locate claude CLI pid");
        epochMs = Date.now();
      } else {
        epochMs = Date.now();
        forceKill(cliPidAtTrigger);
        console.log(`[${scenarioId}] killed CLI pid=${cliPidAtTrigger} at t=${epochMs}`);
      }
    } else {
      epochMs = Date.now();
      forceKill(innerPid);
      console.log(`[${scenarioId}] killed inner Node pid=${innerPid} at t=${epochMs}`);
    }
  } else {
    // normal-completion / interrupt / subagent: innerSession自身が自然に終了するのを待つ
    await innerExited;
    epochMs = Date.now();
    console.log(`[${scenarioId}] inner session exited naturally at t=${epochMs}`);
  }

  // ここから固定の観測窓。サーバー(と該当すればCLI)の生死を同じ実装で追跡する。
  const [serverOutcome, cliOutcome] = await Promise.all([
    trackLiveness(serverPid, OBSERVE_WINDOW_MS, epochMs),
    cliPidAtTrigger !== null ? trackLiveness(cliPidAtTrigger, OBSERVE_WINDOW_MS, epochMs) : Promise.resolve(null),
  ]);

  // 安全のための後片付け(観測結果には影響しない、観測終了後の処理)
  if (serverOutcome.pid !== null && isAlive(serverOutcome.pid)) forceKill(serverOutcome.pid);
  if (cliPidAtTrigger !== null && isAlive(cliPidAtTrigger)) forceKill(cliPidAtTrigger);
  if (isAlive(innerPid)) forceKill(innerPid);

  const result: ScenarioResult = {
    trigger,
    behavior,
    triggerAt: new Date(epochMs).toISOString(),
    finishedAt: new Date().toISOString(),
    server: serverOutcome,
    cli: cliOutcome,
    serverEvents: readEvents(eventsLog),
    notes,
  };

  writeFileSync(path.join(RESULTS_DIR, `${scenarioId}.json`), JSON.stringify(result, null, 2));
  console.log(
    `[${scenarioId}] DONE server_died_at_ms=${serverOutcome.diedAtMs} cli_died_at_ms=${cliOutcome?.diedAtMs ?? "n/a"}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
