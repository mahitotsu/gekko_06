| trigger | behavior | server(MCPサーバー) | cli(claudeプロセス) |
|---|---|---|---|
| interrupt | ignore-signals | 死亡 (+1.04s) | n/a |
| interrupt | ignore-signals-and-eof | 死亡 (+1.04s) | n/a |
| interrupt | normal | 死亡 (+0.00s) | n/a |
| kill-cli | ignore-signals | 死亡 (+6.15s) | 死亡 (+0.20s) |
| kill-cli | ignore-signals-and-eof | 死亡 (+6.20s) | 死亡 (+0.20s) |
| kill-cli | normal | 死亡 (+6.19s) | 死亡 (+0.20s) |
| kill-node | ignore-signals | 死亡 (+8.33s) | 死亡 (+8.74s) |
| kill-node | ignore-signals-and-eof | 死亡 (+13.50s) | 死亡 (+12.65s) |
| kill-node | normal | 死亡 (+8.56s) | 死亡 (+8.96s) |
| normal-completion | ignore-signals | 死亡 (+0.00s) | n/a |
| normal-completion | ignore-signals-and-eof | 死亡 (+0.85s) | n/a |
| normal-completion | normal | 死亡 (+0.00s) | n/a |
| subagent | ignore-signals | 死亡 (+0.00s) | n/a |
| subagent | ignore-signals-and-eof | 死亡 (+0.83s) | n/a |
| subagent | normal | 死亡 (+0.00s) | n/a |
