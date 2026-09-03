| trigger | behavior | server(MCPサーバー) | cli(claudeプロセス) |
|---|---|---|---|
| interrupt | ignore-signals | n=20 平均1.09s 中央値1.01s (1.00s〜1.20s) σ=0.10s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| interrupt | ignore-signals-and-eof | n=20 平均1.08s 中央値1.00s (1.00s〜1.20s) σ=0.10s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| interrupt | normal | n=20 平均0.45s 中央値0.00s (0.00s〜1.20s) σ=0.57s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| kill-cli | ignore-signals | n=20 平均6.29s 中央値6.21s (6.19s〜7.68s) σ=0.33s | n=20 平均0.20s 中央値0.20s (0.20s〜0.20s) σ=0.00s |
| kill-cli | ignore-signals-and-eof | n=20 平均6.21s 中央値6.21s (6.11s〜6.22s) σ=0.02s | n=20 平均0.20s 中央値0.20s (0.20s〜0.20s) σ=0.00s |
| kill-cli | normal | n=20 平均6.29s 中央値6.21s (6.17s〜7.69s) σ=0.33s | n=20 平均0.20s 中央値0.20s (0.20s〜0.20s) σ=0.00s |
| kill-node | ignore-signals | n=20 平均8.26s 中央値8.22s (7.81s〜9.22s) σ=0.34s | n=20 平均8.80s 中央値8.82s (8.41s〜9.84s) σ=0.35s |
| kill-node | ignore-signals-and-eof | n=20 平均13.42s 中央値13.23s (12.83s〜14.70s) σ=0.48s | n=20 平均12.68s 中央値12.63s (12.23s〜13.90s) σ=0.45s |
| kill-node | normal | n=20 平均8.57s 中央値8.52s (8.02s〜9.22s) σ=0.30s | n=20 平均9.11s 中央値9.06s (8.62s〜9.62s) σ=0.27s |
| normal-completion | ignore-signals | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| normal-completion | ignore-signals-and-eof | n=20 平均0.78s 中央値0.80s (0.60s〜1.00s) σ=0.09s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| normal-completion | normal | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| subagent | ignore-signals | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| subagent | ignore-signals-and-eof | n=20 平均0.80s 中央値0.80s (0.80s〜0.83s) σ=0.01s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
| subagent | normal | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s | n=20 平均0.00s 中央値0.00s (0.00s〜0.00s) σ=0.00s |
