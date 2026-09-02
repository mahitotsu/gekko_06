// Trigger×ServerBehaviorの2軸とは別枠の確認: MCPサーバーは「query()呼び出し(セッション)」単位に
// 紐づくのか、それとも「メインNode.jsプロセス」単位で共有されるのか。
// トリガー/行儀を検証する軸ではないため、behaviorは常にnormalに固定し、共通コンポーネントだけを再利用する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildMcpServerConfig } from "./src/mcpServer";
import { buildOptions, buildPrompt } from "./src/queryOptions";
import { isAlive, waitFor } from "./src/processUtils";
import { RUN_DIR, RESULTS_DIR, SERVER_READY_TIMEOUT_MS } from "./src/constants";

async function runOneSession(label: string): Promise<number> {
  const dir = path.join(RUN_DIR, "topology", label);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const pidFile = path.join(dir, "server.pid");
  const eventsLog = path.join(dir, "server-events.jsonl");

  const mcpServers = buildMcpServerConfig("normal", { pidFile, eventsLog });
  const options = buildOptions("normal-completion", mcpServers);
  const q = query({ prompt: buildPrompt("normal-completion"), options: options as any });

  await waitFor(() => existsSync(pidFile), SERVER_READY_TIMEOUT_MS);
  const pid = Number(readFileSync(pidFile, "utf8").trim());

  for await (const _msg of q) {
    // 完了まで読み進めるだけ
  }
  return pid;
}

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);

  // 逐次: メインプロセスを終了させずに2回連続でセッションを実行する
  const seqPid1 = await runOneSession("sequential-1");
  const seqPid1AliveAfter = isAlive(seqPid1);
  const seqPid2 = await runOneSession("sequential-2");
  const seqPid2AliveAfter = isAlive(seqPid2);

  // 並列: 2つのセッションを同時に開始し、両方が同時刻に生存しているかを確認する
  const dirA = path.join(RUN_DIR, "topology", "parallel-a");
  const dirB = path.join(RUN_DIR, "topology", "parallel-b");
  rmSync(dirA, { recursive: true, force: true });
  rmSync(dirB, { recursive: true, force: true });
  mkdirSync(dirA, { recursive: true });
  mkdirSync(dirB, { recursive: true });
  const pidFileA = path.join(dirA, "server.pid");
  const pidFileB = path.join(dirB, "server.pid");

  const qA = query({
    prompt: buildPrompt("normal-completion"),
    options: buildOptions("normal-completion", buildMcpServerConfig("normal", { pidFile: pidFileA, eventsLog: path.join(dirA, "e.jsonl") })) as any,
  });
  const qB = query({
    prompt: buildPrompt("normal-completion"),
    options: buildOptions("normal-completion", buildMcpServerConfig("normal", { pidFile: pidFileB, eventsLog: path.join(dirB, "e.jsonl") })) as any,
  });
  const drainA = (async () => {
    for await (const _m of qA) {
      /* drain */
    }
  })();
  const drainB = (async () => {
    for await (const _m of qB) {
      /* drain */
    }
  })();

  await Promise.all([waitFor(() => existsSync(pidFileA), SERVER_READY_TIMEOUT_MS), waitFor(() => existsSync(pidFileB), SERVER_READY_TIMEOUT_MS)]);
  const parPidA = Number(readFileSync(pidFileA, "utf8").trim());
  const parPidB = Number(readFileSync(pidFileB, "utf8").trim());
  const bothAliveTogether = isAlive(parPidA) && isAlive(parPidB);

  await Promise.all([drainA, drainB]);

  const result = {
    sequential: {
      session1Pid: seqPid1,
      session1AliveAfterOwnSessionEnded: seqPid1AliveAfter,
      session2Pid: seqPid2,
      session2AliveAfterOwnSessionEnded: seqPid2AliveAfter,
      samePid: seqPid1 === seqPid2,
    },
    parallel: {
      sessionAPid: parPidA,
      sessionBPid: parPidB,
      bothAliveAtSameInstant: bothAliveTogether,
      samePid: parPidA === parPidB,
    },
  };

  mkdirSync(RESULTS_DIR, { recursive: true });
  writeFileSync(path.join(RESULTS_DIR, "topology.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
}

main();
