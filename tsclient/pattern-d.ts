// Pattern D: 同一Nodeプロセス(メインプロセス)を終了させずに、
// query() を2回連続で実行し、MCPサーバー子プロセスが
// 「query()呼び出し(セッション)単位」なのか「メインプロセス単位」なのかを確認する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { readFileSync, existsSync, rmSync } from "node:fs";
import { execSync } from "node:child_process";

const PID_FILE = "/home/akring/gekko_0/run/server.pid";
const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function readPid(): number {
  return Number(readFileSync(PID_FILE, "utf8").trim());
}

async function runOneQuery(label: string, text: string): Promise<number> {
  if (existsSync(PID_FILE)) rmSync(PID_FILE);

  const q = query({
    prompt: `echoツール(mcp__mcpverify__echo)を使って text='${text}' をechoしてください。`,
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
        },
      },
      allowedTools: ["mcp__mcpverify__echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 5,
    },
  });

  for await (const msg of q) {
    if (msg.type === "assistant") {
      const content = (msg as any).message?.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (c.type === "tool_use") console.log(`  [${label}] tool_use:`, c.name, JSON.stringify(c.input));
        }
      }
    }
  }
  const pid = readPid();
  console.log(`[${label}] query() finished. server pid=${pid}`);
  return pid;
}

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);

  const pid1 = await runOneQuery("query#1", "first-query");

  // query#1完了直後の生死
  console.log(`[query#1] immediately after: pid=${pid1} alive=${isAlive(pid1)}`);
  // 少し待って(パターンAの実測から、~0.5秒程度で死ぬはず)確実に死んでいることを確認
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`[query#1] +2s later: pid=${pid1} alive=${isAlive(pid1)}`);

  console.log("=== メインNodeプロセスは終了させず、続けて2回目のquery()を開始します ===");

  const pid2 = await runOneQuery("query#2", "second-query");
  console.log(`[query#2] immediately after: pid=${pid2} alive=${isAlive(pid2)}`);
  await new Promise((r) => setTimeout(r, 2000));
  console.log(`[query#2] +2s later: pid=${pid2} alive=${isAlive(pid2)}`);

  console.log("=== 結果 ===");
  console.log(`pid1=${pid1}, pid2=${pid2}, same_pid=${pid1 === pid2}`);
  console.log(
    pid1 === pid2
      ? "→ 同一プロセスが再利用された(メインプロセス単位で生存している可能性)"
      : "→ 異なるプロセスが起動された(query()=セッション単位でMCPサーバーが立ち上げ直されている)"
  );
}

main()
  .then(() => {
    console.log("=== main() resolved, script about to exit naturally ===");
  })
  .catch((err) => {
    console.error("main() error:", err);
    process.exitCode = 1;
  });
