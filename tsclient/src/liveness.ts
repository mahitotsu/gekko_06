import { isAlive, sleep } from "./processUtils";
import type { LivenessSample, ProcessOutcome } from "./types";
import { POLL_INTERVAL_MS } from "./constants";

/** pidの生死を一定間隔でポーリングし続ける唯一の実装。
 * 全シナリオがこれを使うことで、ポーリング間隔や記録形式のばらつきをなくす。 */
export async function trackLiveness(pid: number | null, windowMs: number, epochMs: number): Promise<ProcessOutcome> {
  if (pid === null) {
    return { pid: null, samples: [], diedAtMs: null, aliveAtWindowEnd: false };
  }
  const samples: LivenessSample[] = [];
  let diedAtMs: number | null = null;

  while (Date.now() - epochMs < windowMs) {
    const atMs = Date.now() - epochMs;
    const alive = isAlive(pid);
    samples.push({ atMs, alive });
    if (!alive && diedAtMs === null) diedAtMs = atMs;
    if (!alive) break; // 一度死んだら、それ以上ポーリングを続ける意味はない
    await sleep(POLL_INTERVAL_MS);
  }

  const aliveAtWindowEnd = samples.length > 0 ? samples[samples.length - 1].alive : isAlive(pid);
  return { pid, samples, diedAtMs, aliveAtWindowEnd };
}
