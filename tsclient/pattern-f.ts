// Pattern F: シグナル(SIGINT/SIGTERM/SIGHUP)もstdinのEOFも両方無視する
// 「最強に強情な」MCPサーバーに対して、Claude Code CLIが最終的にSIGKILLへ
// エスカレーションするのか、それとも放置するのかを確認する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server-f.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const SHUTDOWN_LOG = "/home/akring/gekko_0/run/server-shutdown-cause-f.log";
if (existsSync(SHUTDOWN_LOG)) rmSync(SHUTDOWN_LOG);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);

  const q = query({
    prompt: "echoツール(mcp__mcpverify__echo)を使って text='pattern-f' をechoしてください。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
          env: {
            ...process.env,
            MCPVERIFY_IGNORE_SIGNALS: "1",
            MCPVERIFY_NEVER_EXIT: "1",
            MCPVERIFY_PID_FILE: PID_FILE,
            MCPVERIFY_SHUTDOWN_LOG: SHUTDOWN_LOG,
          } as Record<string, string>,
        },
      },
      allowedTools: ["mcp__mcpverify__echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 5,
    },
  });

  for await (const msg of q) {
    console.log(`[msg] type=${msg.type}` + (msg.type === "result" ? ` subtype=${(msg as any).subtype}` : ""));
  }
  console.log(`=== for-await loop finished at t=${Date.now()} ===`);
}

main().then(() => console.log(`=== main() resolved at t=${Date.now()} ===`));
