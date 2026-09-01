// Pattern E: SIGTERM/SIGINTを無視する「行儀の悪い」MCPサーバーの場合、
// Claude Code CLIは最終的にSIGKILLへエスカレーションするのか、それとも放置(プロセスリーク)するのか。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const SHUTDOWN_LOG = "/home/akring/gekko_0/run/server-shutdown-cause.log";
if (existsSync(SHUTDOWN_LOG)) rmSync(SHUTDOWN_LOG);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);

  const q = query({
    prompt: "echoツール(mcp__mcpverify__echo)を使って text='pattern-e' をechoしてください。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
          env: { ...process.env, MCPVERIFY_IGNORE_SIGNALS: "1" } as Record<string, string>,
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
