# 検証ハーネス

stdio型MCPサーバー(`uv run`で起動するPythonサーバー)の子プロセスが、
Claude Agent SDK (TypeScript) のセッション終了時にどう扱われるかを検証するハーネス。

## 設計原則

検証対象の軸は2つだけ:

- **Trigger**(終了トリガー): `normal-completion` / `interrupt` / `subagent` / `kill-cli` / `kill-node`
- **ServerBehavior**(MCPサーバーの行儀): `normal` / `ignore-signals` / `ignore-signals-and-eof`

この2軸**以外**の条件(ポーリング間隔、観察時間、ツール呼び出しの秒数、
許可ツール、permissionMode等)は `src/constants.ts` に一箇所だけ定義し、
全シナリオで共有する。個々のシナリオ実装がこれらの値を独自に変えることはない。

## 構成

```
src/
  types.ts          Trigger/ServerBehavior/ScenarioResult などの型定義
  constants.ts       全シナリオで共有する固定パラメータ
  mcpServer.ts        stdio MCPサーバーの起動設定を組み立てる唯一の場所
  queryOptions.ts      query()のoptions/promptを組み立てる唯一の場所
  processUtils.ts       プロセス生存確認・CLI PID特定などの純粋関数
  eventsLog.ts            サーバーが書く構造化イベントログの読み取り/イベント待機
  liveness.ts               プロセス生死ポーリングの唯一の実装

innerSession.ts    実際にquery()を駆動する側。runScenario.tsに子プロセスとして起動される。
                    トリガーによる分岐は「interruptなら自己中断する」の1点のみ。
runScenario.ts      1つの (Trigger, ServerBehavior) を実行する唯一のエントリポイント。
                    起動待ち→トリガー適用→固定時間の生死観測→結果JSON書き出し、という
                    同じ手順を全シナリオが通る。
runMatrix.ts         Trigger×ServerBehaviorの全組み合わせをrunScenario.ts経由で逐次実行する。
runTopology.ts        セッション/プロセスの対応関係(逐次・並列)の確認。2軸とは別枠。
renderMatrix.ts        results/*.json から決定表を機械的に生成する。
```

## 実行方法

```bash
npm run matrix              # 全15組み合わせ(5 trigger × 3 behavior)を実行
npm run matrix:one -- --trigger=kill-cli --behavior=normal   # 1つだけ実行
npm run topology             # セッション/プロセスの対応関係の確認
npm run render                # results/*.json から決定表(Markdown)を生成
```

結果は `../run/<trigger>__<behavior>/`(生ログ)と `../results/<trigger>__<behavior>.json`
(構造化された結果)に書き出される。決定表は手で転記せず、必ず `renderMatrix.ts` で
生成する(実測値と記事上の表が食い違うことを防ぐため)。
