import { existsSync, readFileSync } from "node:fs";
import type { ServerEvent } from "./types";
import { sleep } from "./processUtils";

export function readEvents(eventsLogPath: string): ServerEvent[] {
  if (!existsSync(eventsLogPath)) return [];
  return readFileSync(eventsLogPath, "utf8")
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ServerEvent);
}

/** サーバーの構造化イベントログに、指定イベントが出現するまで待つ。
 * sleep(N)による当てずっぽうの同期を避けるための唯一の同期手段。 */
export async function waitForEvent(
  eventsLogPath: string,
  eventName: string,
  timeoutMs: number,
  pollMs = 50
): Promise<ServerEvent | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const events = readEvents(eventsLogPath);
    const found = events.find((e) => e.event === eventName);
    if (found) return found;
    await sleep(pollMs);
  }
  return null;
}
