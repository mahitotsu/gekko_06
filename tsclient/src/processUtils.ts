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

/** claude CLIバイナリ(SDK同梱のプラットフォーム別実行ファイル)にマッチする全PIDを返す。
 * 呼び出し側で「マッチが複数ある/ゼロ」を明示的に扱えるようにするため、
 * 曖昧な先頭1件選択はここでは行わない。 */
export function findClaudeCliPids(): number[] {
  try {
    const out = execFileSync("pgrep", ["-f", "claude-agent-sdk-.*/claude"], { encoding: "utf8" });
    return out
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(Number);
  } catch {
    return []; // pgrepはマッチなしでexit code 1になる
  }
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
