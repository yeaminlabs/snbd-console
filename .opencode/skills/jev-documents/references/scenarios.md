# Explore workflow examples

Browse the examples and read the guides, input/output and sources that help with
your design. Compare or combine several workflows when useful; local templates
are starting points to adapt, not a complete solution. A project link is a source,
not an installed backend or a tested integration.

| Task | Full example | Local start |
|---|---|---|
| Rerank search and retrieval results | [22](https://github.com/wuyoscar/jev-skill#sc-a19) | [Template](../assets/example.json) |
| Repository navigation | [23](https://github.com/wuyoscar/jev-skill#sc-a20) | [Template](../assets/find-code.json) |
| Find meaning on a page, not just matching words | [38](https://github.com/wuyoscar/jev-skill#sc-semantic-find) | [Template](../assets/example.json) |
| Reading-list/literature screen | [51](https://github.com/wuyoscar/jev-skill#sc-h07) | [Template](../assets/example.json) |
| Claim-to-source check | [52](https://github.com/wuyoscar/jev-skill#sc-h08) | [Template](../assets/example.json) |
| Policy checklist triage | [53](https://github.com/wuyoscar/jev-skill#sc-h09) | [Template](../assets/example.json) |
| Contract-clause sorting | [54](https://github.com/wuyoscar/jev-skill#sc-h10) | [Template](../assets/example.json) |
| Job-requirement evidence organization | [56](https://github.com/wuyoscar/jev-skill#sc-h21) | [Template](../assets/example.json) |
| Extract the right original value | [57](https://github.com/wuyoscar/jev-skill#sc-spans) | [Template](../assets/example.json) |
| Check whether any candidate is actually suitable | [58](https://github.com/wuyoscar/jev-skill#sc-suitability) | [Template](../assets/example.json) |
| Recover headings, lists and paragraphs | [59](https://github.com/wuyoscar/jev-skill#sc-structure) | [Template](../assets/example.json) |
| Extract date meaning, then resolve it in code | [60](https://github.com/wuyoscar/jev-skill#sc-dates) | [Template](../assets/example.json) |
| Check a cheap model’s structured extraction | [61](https://github.com/wuyoscar/jev-skill#sc-extraction-cascade) | [Template](../assets/example.json) |
| Annotate talks, interviews or presentations | [62](https://github.com/wuyoscar/jev-skill#sc-transcript) | [Template](../assets/example.json) |
| Duplicate/entity matching | [65](https://github.com/wuyoscar/jev-skill#sc-h05) | [Template](../assets/example.json) |
| Navigate a knowledge graph or large hierarchy | [68](https://github.com/wuyoscar/jev-skill#sc-graph) | [Template](../assets/find-code.json) |
| Find a useful command from your history | [71](https://github.com/wuyoscar/jev-skill#sc-shell-history) | [Template](../assets/example.json) |
| Rank launcher results by intent | [95](https://github.com/wuyoscar/jev-skill#sc-launcher) | [Template](../assets/example.json) |
| Find a relevant clipboard item | [99](https://github.com/wuyoscar/jev-skill#sc-clipboard) | [Template](../assets/example.json) |

## Measured examples

OCNLI inference and BoolQ passage-supported answers. [Same-item model results, actual I/O and reproduction](https://github.com/wuyoscar/jev-skill/blob/main/docs/experiments/model-panel/README.md). These are small native/adapted/synthetic pilots, not proof that every workflow above succeeds. Re-run a labeled holdout for your task before scaling; never treat a review flag or high probability as action permission.
