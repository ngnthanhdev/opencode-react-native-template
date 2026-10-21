# Run Journal — <type>/<slug> · phase-<N>-task-<NN>

> Artifact trạng thái để **resume cross-session**. **Primary ghi file này; subagent KHÔNG ghi.**
> Đọc file này **ĐẦU TIÊN** khi mở session mới (xem `.agent/session-handoff.md`).
> Copy template này thành `.context/runs/<type>-<slug>-<phaseTask>.md` khi bắt đầu task.

```yaml
workItem: feature/<slug>            # feature|bug / <slug>
phaseTask: phase-<N>-task-<NN>      # key đầy đủ, gồm cả -mod-<M> nếu có
step: ready                         # ready|builder|reviewer|fix|spec_validator|closeout|done
agent: null                         # agent đang thực thi bước này: builder|builder-strong|reviewer|design|graph|spec-init|spec-publisher|spec-validator|change-request
status: awaiting                    # running|awaiting|done|blocked
attempt: 0                          # CHỈ tăng khi FAIL thật; KHÔNG tăng khi interrupted
interrupted: false                  # true nếu bị cắt ngang giữa step → redo step, không tính attempt
updatedAt: <ISO-8601>
filesTouched: []                    # file M (git status) thuộc task này
filesNew: []                        # file ?? (untracked) thuộc task này
evidence:
  reportPath: null                  # đường dẫn report reviewer/spec CHÍNH XÁC
  round: 0
  verdict: null                     # PASS|FAIL|null
next: ""                            # một dòng: việc kế tiếp
loopSignal: none                    # none | repeated:<tool>
approvals: []                       # [{gate: phase_plan|phase_done, at, ok}]
batchQueue: []                      # thứ tự list bug/feature nếu có
```

## Notes / WIP reasoning

<lý luận dở, quyết định đang cân nhắc, root cause đang điều tra>

## History

- <ISO-8601> journal created
