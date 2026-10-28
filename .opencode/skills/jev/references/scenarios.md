# Explore workflow examples

Browse the examples and read the guides, input/output and sources that help with
your design. Compare or combine several workflows when useful; local templates
are starting points to adapt, not a complete solution. A project link is a source,
not an installed backend or a tested integration.

| Task | Full example | Local start |
|---|---|---|
| Goal-drift checkpoint | [1](https://github.com/wuyoscar/jev-skill#sc-a01) | [Template](../assets/checkpoint.json) |
| Stuck-loop recovery | [2](https://github.com/wuyoscar/jev-skill#sc-a02) | [Template](../assets/checkpoint.json) |
| Postmortem failure attribution | [5](https://github.com/wuyoscar/jev-skill#sc-a27) | [Template](../assets/checkpoint.json) |
| Action-risk triage | [9](https://github.com/wuyoscar/jev-skill#sc-a10) | [Template](../assets/semantic-rules.json) |
| User absent, safe work remains | [15](https://github.com/wuyoscar/jev-skill#sc-a04) | [Template](../assets/checkpoint.json) |
| Decide whether to escalate | [16](https://github.com/wuyoscar/jev-skill#sc-a05) | [Template](../assets/routing.json) |
| Tool routing | [18](https://github.com/wuyoscar/jev-skill#sc-a15) | [Template](../assets/routing.json) |
| Model tier routing | [19](https://github.com/wuyoscar/jev-skill#sc-a16) | [Template](../assets/routing.json) |
| Specialist delegation | [20](https://github.com/wuyoscar/jev-skill#sc-a17) | [Template](../assets/routing.json) |
| Skill/tool discovery | [21](https://github.com/wuyoscar/jev-skill#sc-a18) | [Template](../assets/routing.json) |
| Recoverable output reduction | [24](https://github.com/wuyoscar/jev-skill#sc-a21) | [Template](../assets/context.json) |
| Duplicate observation suppression | [25](https://github.com/wuyoscar/jev-skill#sc-a22) | [Template](../assets/context.json) |
| Choose a safe moment to compact | [26](https://github.com/wuyoscar/jev-skill#sc-compaction) | [Template](../assets/context.json) |
| Personal-assistant handoff | [30](https://github.com/wuyoscar/jev-skill#sc-a26) | [Template](../assets/routing.json) |
| Turn observations into reusable situation labels | [32](https://github.com/wuyoscar/jev-skill#sc-situations) | [Template](../assets/semantic-rules.json) |
| Compare options with weights you can change | [78](https://github.com/wuyoscar/jev-skill#sc-reweight) | [Template](../assets/rubric.json) |
| Choose an image or video generator for a request | [84](https://github.com/wuyoscar/jev-skill#sc-creative-route) | [Template](../assets/routing.json) |
| Turn a plain-language task into editable questions | [87](https://github.com/wuyoscar/jev-skill#sc-compile) | [Template](../assets/prompt-to-jev.json) |
| Add reusable decision tools through MCP | [88](https://github.com/wuyoscar/jev-skill#sc-mcp) | [Template](../assets/triage.json) |
| Learn by changing examples in a playground | [89](https://github.com/wuyoscar/jev-skill#sc-playground) | [Template](../assets/triage.json) |
| Experiment with semantic control flow | [96](https://github.com/wuyoscar/jev-skill#sc-language) | [Template](../assets/triage.json) |

## Measured examples

BBH, Chinese logic, Ruozhiba and paired context checks. [Same-item model results, actual I/O and reproduction](https://github.com/wuyoscar/jev-skill/blob/main/docs/experiments/model-panel/README.md). These are small native/adapted/synthetic pilots, not proof that every workflow above succeeds. Re-run a labeled holdout for your task before scaling; never treat a review flag or high probability as action permission.
