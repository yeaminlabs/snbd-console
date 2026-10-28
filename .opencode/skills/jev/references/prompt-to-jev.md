# Turn a prompt into Jev questions

Read this only when converting a prompt or designing a new decision. You do not
need the project catalog. The conversion is done by the host agent, not by Jev.

## One small pass

1. Read the prompt and the code that consumes its output: inputs, allowed labels,
   rules, missing-data behavior and examples. Use the repo's required search tools.
2. Split the work. One label becomes **Choice**; one proposition becomes **Noul**;
   a graded judgment becomes **Score** with described levels. Exact matching,
   arithmetic, counting and date comparisons stay in code. Writing stays with a
   generative model. Drop instructions that only ask for JSON formatting.
3. Keep the evidence each question needs in `state`. Separate trusted rules from
   untrusted input. Keep useful context, not the host's whole conversation. Do not
   invent candidates or facts. Ask only about gaps that change the decision.
4. Put independent questions over that evidence in the same request. Questions
   cannot read each other's answers. If a later question needs a selected document
   or an action result, collect it first; call again only if a judgment is still
   needed. Across separate
   requests, the host may use bounded concurrency with IDs and a cost/time budget;
   the CLI itself has no scheduler.
5. Validate with the existing CLI. Show the request and any assumptions. Only add
   a split table or calling code when the task needs it. Agree what happens on
   unknown, review and errors before using any answer to take an action.

## Before → after

**Prompt:** "Route this ticket to billing, access or other. Flag a refund request.
Rate impact: no disruption, limited disruption, or unable to work. If a refund is
requested, the amount is over 100 and the purchase is over 30 days old, send it
for review. Write a helpful reply. Return JSON."

| Part | Where it goes |
|---|---|
| Which team? | Choice: billing, access, other |
| Refund requested? | Noul, one proposition |
| Work impact? | Score, three described levels |
| Amount > 100 and age > 30 days | Code, using validated numeric inputs |
| Write a reply | Keep with a generative model; not part of this request |
| Return JSON | Drop; Jev already returns typed answers |

All three questions can share the ticket text. Amount and age need not enter
`state`: no model judgment needs them. The caller checks these exact rules after
reading the refund result. Never treat a low-probability false Noul as true just
because the request succeeded. Missing amount or age requires review, not zero.

[Request](../assets/prompt-to-jev.json) · [Calling example](../assets/prompt_to_jev.py)
· [Six conversion checks](../assets/prompt-conversion-cases.json)

The example requires the existing `jev-skill` Python package (module `jev`). It
uses synthetic input, prints a proposed queue and sends no message or refund.
From the installed skill folder:

```bash
python3 <skill-dir>/assets/prompt_to_jev.py --dry-run
# Only after approval to send the example to the selected service:
python3 <skill-dir>/assets/prompt_to_jev.py --provider openrouter
# Or --provider typesafe, using the user's selected official account.
```

For another task, copy the request, replace its evidence and questions, and use
`jev-decide decide request.json --dry-run`. If code is requested, adapt the small
example to the real input and consumer; test all branches before automating.
Syntax checks do not prove that a model followed the conversion guide. Review the
six checks against the agent's actual conversion, including missing evidence and
dependent steps. Keep live outputs separate from expected test labels.

The checks include worked outcomes: a missing ticket stays in collect/review with
no request, and document selection is followed by a separate claim check only
after the host reads the document. Their observations are authored fixtures, not
retrieved evidence. The applicable requests pass the existing offline CLI.

## Source

Thanks to [sumleo/prompt2jev](https://github.com/sumleo/prompt2jev) for the focused
prompt-conversion workflow. This guide and example are a small adaptation for
this collection, using its existing CLI and review policy, not a bundled copy of
the upstream CLI. Retain upstream copyright and MIT terms if copying its code or
substantial text. For question details, read [question design](question-design.md)
only when needed; for higher volumes, read [batching](context-and-throughput.md).
