// プロセスツリー観察用: slow_echoで十数秒サーバーを稼働させ続け、
// その間に外部から `ps --forest` 等でNodeプロセス〜MCPサーバーの親子関係を確認できるようにする。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);

  const q = query({
    prompt:
      "slow_echoツールを使って text='tree-check', delay_seconds=15 で呼び出してください。結果が返るまで待ってください。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
        },
      },
      allowedTools: ["mcp__mcpverify__slow_echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 5,
    },
  });

  for await (const msg of q) {
    console.log(`[msg] type=${msg.type}` + (msg.type === "result" ? ` subtype=${(msg as any).subtype}` : ""));
  }
  console.log("=== for-await loop finished ===");
}

main().then(() => console.log("=== main() resolved ==="));
