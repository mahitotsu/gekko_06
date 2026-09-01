// Pattern G: 同一メインプロセス内で query() を2つ「同時に」(並列で)実行し、
// MCPサーバーが2プロセス起動するのか、1プロセスが共有されるのかを確認する。
// 各セッションに別々のPIDファイルを持たせ、両方が"同時刻に"生存しているかを直接確認する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, rmSync } from "node:fs";

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPidWhenReady(pidFile: string, timeoutMs = 20000): Promise<number> {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tick = () => {
      if (existsSync(pidFile)) {
        resolve(Number(readFileSync(pidFile, "utf8").trim()));
        return;
      }
      if (Date.now() - start > timeoutMs) {
        reject(new Error(`timeout waiting for ${pidFile}`));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

async function runSession(label: string, pidFile: string, delaySeconds: number) {
  if (existsSync(pidFile)) rmSync(pidFile);

  const q = query({
    prompt: `slow_echoツール(mcp__mcpverify__slow_echo)を使って text='${label}', delay_seconds=${delaySeconds} で呼び出してください。`,
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
          env: { ...process.env, MCPVERIFY_PID_FILE: pidFile } as Record<string, string>,
        },
      },
      allowedTools: ["mcp__mcpverify__slow_echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 5,
    },
  });

  for await (const msg of q) {
    if (msg.type === "result") console.log(`[${label}] result subtype=${(msg as any).subtype}`);
  }
  console.log(`[${label}] query() finished`);
}

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);

  const pidFile1 = "/home/akring/gekko_0/run/server-g1.pid";
  const pidFile2 = "/home/akring/gekko_0/run/server-g2.pid";

  // 2つのセッションを同時に開始する(await せず両方走らせる)
  const session1 = runSession("session-1", pidFile1, 8);
  const session2 = runSession("session-2", pidFile2, 8);

  const [pid1, pid2] = await Promise.all([readPidWhenReady(pidFile1), readPidWhenReady(pidFile2)]);
  console.log(`session-1 server pid = ${pid1}`);
  console.log(`session-2 server pid = ${pid2}`);
  console.log(`same_pid = ${pid1 === pid2}`);
  console.log(`both alive at this instant: pid1=${isAlive(pid1)} pid2=${isAlive(pid2)}`);

  // 両方生存中の瞬間をもう一度、少し時間をおいて確認
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`+2s both alive?: pid1=${isAlive(pid1)} pid2=${isAlive(pid2)}`);

  await Promise.all([session1, session2]);

  console.log(`after both sessions finished: pid1_alive=${isAlive(pid1)} pid2_alive=${isAlive(pid2)}`);
}

main().then(() => console.log("=== main() resolved ==="));
