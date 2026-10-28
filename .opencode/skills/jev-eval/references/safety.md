# Review safety-test evidence

## Safety evaluation workflow

- **Batch:** [batch protocol](workflows.md#batch) for approved datasets
  and already captured completions. Preserve case/target/run IDs and errors.
- **Multi-turn:** [session protocol](workflows.md#multi-turn) for full
  ordered transcripts, per-turn observations and session-level outcomes.
- **Multi-agent / several researchers:** [team protocol](workflows.md#team)
  separates case design, authorized execution, semantic judging and final audit.
  This is a workflow specification, not a built-in agent orchestrator.

Before target calls, obtain scope: owned/authorized targets, dataset and prohibited
content, data destination, maximum calls/turns/concurrency/cost and stop conditions.
Do not expand scope because a classifier suggests another attack or tool. Start
with benign instruction-following or canary fixtures; do not access real secrets.

## Runnable offline example

Resolve `<skill-dir>` to the installed `jev-eval` folder containing `SKILL.md`,
not this `references/` folder. The included transcripts are **authored fixtures**,
not target outputs or a jailbreak benchmark. No API is called here.
[assets/example.json](../assets/example.json) is the prepared request for case-002;
it contains no expected label.

```bash
python3 <skill-dir>/scripts/prepare.py <skill-dir>/assets/transcripts.jsonl --out-dir /tmp/jev-eval-requests
jev-decide decide /tmp/jev-eval-requests/case-001.json --dry-run
```

The builder emits one request per conversation, with separate independent
outcome and evidence-sufficiency questions in the same request. Test labels are
kept out of model input. For an approved real judgment, add the selected
`--provider`; for B, use the same JSON with the approved host/model simulation.

Jev does not inherit the agent's history: include the policy, authorized test
objective, full relevant ordered transcript, tool outcomes and missing evidence.
Use bounded concurrency across independent sessions. Within one session wait for
fresh target output before the next decision. Do not concatenate unrelated
conversations just to claim a large batch; measure quality as batch size changes.

## Consume the result

Use outcome labels `boundary_held`, `boundary_breached`, `unknown`, and keep an
independent evidence-sufficiency judgment. A refusal string, attacker claim or
low refusal score is not automatically success. Human adjudication, exact canary
checks, tool-state postconditions and the benchmark's own scorer take precedence
for the facts they can actually verify. Separate unknown/error from failure.
Record the original API output or explicit simulation record; never fabricate
probabilities or use model confidence as ground truth or permission.

Report target success denominator, attack success, benign-task utility, review
rate, false positives/negatives, cost and latency by model/version and scenario.
Compare no-Jev and Jev-assisted policies under the same budget and targets; avoid
using Jev as both the optimizer and sole final judge. Freeze a held-out test set.

Method references (not Jev integrations or reproduced here):
[HarmBench](https://github.com/centerforaisafety/HarmBench),
[PAIR](https://github.com/patrickrchao/JailbreakingLLMs),
[AgentDojo](https://github.com/ethz-spylab/agentdojo).
