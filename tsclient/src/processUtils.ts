import { execFileSync } from "node:child_process";

export function isAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function forceKill(pid: number): void {
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // すでに死んでいれば何もしない
  }
}

/** システム上の全プロセスの (pid, ppid, cmd) を読む。 */
function listAllProcesses(): Array<{ pid: number; ppid: number; cmd: string }> {
  const out = execFileSync("ps", ["-eo", "pid=,ppid=,cmd="], { encoding: "utf8" });
  return out
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
      if (!m) return null;
      return { pid: Number(m[1]), ppid: Number(m[2]), cmd: m[3] };
    })
    .filter((x): x is { pid: number; ppid: number; cmd: string } => x !== null);
}

/** rootPidの子孫プロセス(rootPid自身は含まない)を全て返す。
 * システム全体からのcmdline一致検索(pgrep -f)は、この環境のように他のセッションが
 * 同名バイナリを動かしていることがあるため、無関係なプロセスを誤って拾う危険がある。
 * 必ずこの関数でプロセスツリーをたどり、対象を自分が起動した子孫に限定すること。 */
export function findDescendantPids(rootPid: number): Array<{ pid: number; ppid: number; cmd: string }> {
  const all = listAllProcesses();
  const byPpid = new Map<number, Array<{ pid: number; ppid: number; cmd: string }>>();
  for (const p of all) {
    if (!byPpid.has(p.ppid)) byPpid.set(p.ppid, []);
    byPpid.get(p.ppid)!.push(p);
  }
  const result: Array<{ pid: number; ppid: number; cmd: string }> = [];
  const stack = [rootPid];
  while (stack.length > 0) {
    const pid = stack.pop()!;
    const children = byPpid.get(pid) ?? [];
    for (const c of children) {
      result.push(c);
      stack.push(c.pid);
    }
  }
  return result;
}

/** rootPidの子孫の中から、claude CLIバイナリ(SDK同梱のプラットフォーム別実行ファイル)に
 * マッチするPIDを返す。rootPidは自分がspawnしたinnerSessionのpidを渡すこと。 */
export function findClaudeCliPidsUnder(rootPid: number): number[] {
  return findDescendantPids(rootPid)
    .filter((p) => /claude-agent-sdk-.*\/claude\b/.test(p.cmd))
    .map((p) => p.pid);
}

export function cmdlineOf(pid: number): string {
  try {
    return execFileSync("ps", ["-o", "args=", "-p", String(pid)], { encoding: "utf8" }).trim();
  } catch {
    return "(not found)";
  }
}

export function waitFor(predicate: () => boolean, timeoutMs: number, intervalMs = 100): Promise<boolean> {
  const start = Date.now();
  return new Promise((resolve) => {
    const tick = () => {
      if (predicate()) return resolve(true);
      if (Date.now() - start > timeoutMs) return resolve(false);
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
