# Find likely code locations

Use this mode through `jev-documents`. Adapt [the request template](../assets/find-code.json)
to the actual evidence and criteria, then follow the parent skill's setup and runtime instructions.

## Workflow

1. Use the project-required graph/index tools first; use exact lookup for known symbols. Use semantic selection when a natural-language question leaves several plausible observed candidates.
2. Build candidates from real paths and observed summaries. State clearly when only path names, rather than file contents, were available.
3. For large trees, select a local branch and then inspect its contents; bound traversal and retain alternate branches rather than treating the first choice as proof.
4. Open the selected source with the appropriate code tool and verify relevance. Update state or backtrack when the file is unrelated.
5. Return inspected paths and concrete evidence separately from uninspected leads. Walker shares, relevance scores and probability of containing a bug are different quantities.

## Context and parallelism

Jev does not inherit the agent's history. Give every request sufficient context:
the problem, observed behavior/errors, relevant prior reads, graph relationships
and real candidate paths with observed summaries or excerpts. Bare filenames alone
may not distinguish candidates; mark what has not been read and omit unrelated
files and secrets, not evidence necessary to rank the candidates.

Batch independent relevance questions over an observed candidate set instead of
serial LLM calls. Use bounded concurrency for independent searches, with stable
path/question IDs, rate limits and a cost/time budget. The host schedules calls;
the CLI has no parallel scheduler. Questions cannot read other answers in the same
request: inspect a chosen branch before asking about its unseen children. Jev's
low latency helps wide ranking; code tools still retrieve and verify actual source.

## Make it yours

Replace the example's evidence, candidate IDs and criteria together. Preserve a
no-match route when the real task can fall outside the labels. Agree on how the
host or person consumes each answer before enabling any automatic effect.

## Precedent

[Related project or author example](https://github.com/ellipsis-dev/blink). Our workflow is an adaptation,
not that project's code, an automatic installer, or a reproduced benchmark.
[OpenRouter request contract](https://openrouter.ai/docs/api/api-reference/alphadecisions/submit-a-decisions-questions-and-answers-request).
