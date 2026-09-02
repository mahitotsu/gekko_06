// 1つの (Trigger, ServerBehavior) の組み合わせを実行する唯一のエントリポイント。
// 全シナリオが同じ手順(起動待ち→CLI PID特定→トリガー適用→固定時間の生死観測→結果書き出し)を通る。
//
// usage: npx tsx runScenario.ts --trigger=<T> --behavior=<B> [--rep=<N>]
// --rep を指定すると、同じ組み合わせを複数回実行して統計を取るための
// 反復インデックスとして扱い、結果ファイル名に __rep<N> を付与する
// (指定しない場合は従来通りの単発実行としてrepなしのファイル名を使う)。
//
// CLIプロセスのPIDは、トリガーの種類に関わらず全シナリオで work_started イベントの
// タイミングに特定し、生死追跡もサーバーと同じ手順で行う(kill-cli/kill-nodeのように
// 直接killする場合はもちろん、normal-completion/interrupt/subagentのように
// 何もしない場合でも、CLIプロセス自身がいつ終了するかを同じ精度で観測する)。
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
import { ALL_BEHAVIORS, ALL_TRIGGERS, type ScenarioResult, type Trigger, type ServerBehavior } from "./src/types";
import { RUN_DIR, RESULTS_DIR, OBSERVE_WINDOW_MS, SERVER_READY_TIMEOUT_MS, WORK_SECONDS } from "./src/constants";
import { waitFor, findClaudeCliPidsUnder, forceKill, isAlive, cmdlineOf } from "./src/processUtils";
import { waitForEvent, readEvents } from "./src/eventsLog";
import { trackLiveness } from "./src/liveness";

function parseArgs(): { trigger: Trigger; behavior: ServerBehavior; rep: number | null } {
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
  const rep = args.rep !== undefined ? Number(args.rep) : null;
  return { trigger, behavior, rep };
}

async function main() {
  const { trigger, behavior, rep } = parseArgs();
  const scenarioId = rep === null ? `${trigger}__${behavior}` : `${trigger}__${behavior}__rep${rep}`;
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

  // 全トリガー共通: work_started の時点でCLIのPIDを特定する。この時点ではCLIは
  // 必ずツール呼び出し中で生きているはずなので、生死追跡の起点として使える。
  const workStarted = await waitForEvent(eventsLog, "work_started", SERVER_READY_TIMEOUT_MS + WORK_SECONDS * 1000);
  if (!workStarted) notes.push("work_started event not observed before timeout");

  // 必ず innerPid の子孫からのみ探す(pgrepのようなシステム全体検索は、他セッションが
  // 同名バイナリを動かしている場合に無関係なプロセスを誤って対象にする危険がある)。
  const cliCandidates = findClaudeCliPidsUnder(innerPid);
  let cliPid: number | null = null;
  if (cliCandidates.length !== 1) {
    notes.push(`expected exactly 1 claude CLI process under innerPid=${innerPid}, found ${cliCandidates.length}: [${cliCandidates.join(",")}]`);
  } else {
    cliPid = cliCandidates[0];
    console.log(`[${scenarioId}] CLI candidate pid=${cliPid} cmdline=${cmdlineOf(cliPid).slice(0, 120)}...`);
  }

  let epochMs: number;

  if (trigger === "kill-cli") {
    epochMs = Date.now();
    if (cliPid !== null) {
      forceKill(cliPid);
      console.log(`[${scenarioId}] killed CLI pid=${cliPid} at t=${epochMs}`);
    }
  } else if (trigger === "kill-node") {
    epochMs = Date.now();
    forceKill(innerPid);
    console.log(`[${scenarioId}] killed inner Node pid=${innerPid} at t=${epochMs}`);
  } else {
    // normal-completion / interrupt / subagent: innerSession自身が自然に終了するのを待つ。
    // このときcliPidは既に特定済みなので、自然終了に至るまでのCLI自身の生死も
    // kill-cli/kill-nodeと同じ精度で追跡できる。
    await innerExited;
    epochMs = Date.now();
    console.log(`[${scenarioId}] inner session exited naturally at t=${epochMs}`);
  }

  // ここから固定の観測窓。サーバーとCLI、両方の生死を全トリガーで同じ実装で追跡する。
  const [serverOutcome, cliOutcome] = await Promise.all([
    trackLiveness(serverPid, OBSERVE_WINDOW_MS, epochMs),
    trackLiveness(cliPid, OBSERVE_WINDOW_MS, epochMs),
  ]);

  // 安全のための後片付け(観測結果には影響しない、観測終了後の処理)
  if (serverOutcome.pid !== null && isAlive(serverOutcome.pid)) forceKill(serverOutcome.pid);
  if (cliPid !== null && isAlive(cliPid)) forceKill(cliPid);
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
    `[${scenarioId}] DONE server_died_at_ms=${serverOutcome.diedAtMs} cli_died_at_ms=${cliOutcome.diedAtMs}`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
