# Check one point in a task

Use [the checkpoint template](../assets/checkpoint.json) for drift or repeated
failures; [completion](../assets/completion.json) for a done claim. Replace the
synthetic evidence. Do not add a call before every obvious step.

Include the user's goal, allowed scope, current attempt, relevant prior failures
and observable results. Ask one question per issue, with wait/review options.
Independent drift and evidence checks may share a request. A decision cannot
supply a missing test result or see an action that has not happened.

Read the answer, then have the host verify evidence and take only an authorized
step. A queued job, exit code or confident DONE label is not proof of completion.
If evidence is missing, collect it. If permission is missing, ask. Do not retry
until the model approves, lower a test or silently expand the task.

For an unfamiliar case, [customization](customization.md) explains the small
input/answer/consumer contract. [The detailed guide](guide.md) is optional further
reading, not a prerequisite to this checkpoint.
