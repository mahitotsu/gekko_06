// Pattern J追試: 即時応答するechoツールを使い、Node.jsプロセスをkillした直後に
// CLIが出力しようとする機会を早めに作る。それでも気づかず生き残るかを確認する。
import { query } from "@anthropic-ai/claude-agent-sdk";
import { existsSync, rmSync } from "node:fs";

const PID_FILE = "/home/akring/gekko_0/run/server-j2.pid";
if (existsSync(PID_FILE)) rmSync(PID_FILE);

const PY_SERVER_DIR = "/home/akring/gekko_0/pyserver";

async function main() {
  console.log(`main Node.js process pid = ${process.pid}`);
  const q = query({
    prompt:
      "まずecho(text='first')を呼んでください。結果を受け取ったら5秒待つふりをして何もツールを呼ばず、" +
      "その後もう一度echo(text='second')を呼んで結果を報告してください。",
    options: {
      mcpServers: {
        mcpverify: {
          type: "stdio",
          command: "uv",
          args: ["run", "--directory", PY_SERVER_DIR, "main.py"],
          env: { ...process.env, MCPVERIFY_PID_FILE: PID_FILE } as Record<string, string>,
        },
      },
      allowedTools: ["mcp__mcpverify__echo"],
      disallowedTools: ["Bash", "Write", "Edit", "Read", "Glob", "Grep", "WebFetch", "WebSearch", "Task"],
      permissionMode: "bypassPermissions",
      maxTurns: 8,
    },
  });

  for await (const msg of q) {
    console.log(`[msg] type=${msg.type} t=${Date.now()}`);
  }
  console.log(`=== finished at t=${Date.now()} ===`);
}

main();
