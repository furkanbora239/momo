# Get work done with momo in OpenCode v2

[Install momo from this checkout](../../README.md#install-from-this-checkout), start OpenCode in your project and choose **momo-orchestrator**. Use `/models` to pick the model for this chat. Jev routes delegated work using current model availability, known capabilities and prices, and your pool settings.


With OpenCode v2.4.2, run `bun /absolute/path/to/momo/dist/cli/index.js chat` from your project to require a model choice before opening a fresh terminal chat. Type to filter the available models. Cancelling the picker exits before creating a session. Supply `--model provider/model` to select the model on the command line. Reopen saved chats with `/sessions` or `opencode --session <id>`. OpenCode’s built-in `/new` keeps its native model selection.
## Start with a task you can verify

Start with an outcome, the files or behavior in scope, and a check you can repeat. For example:

> Make the billing migration reversible. Keep existing clients working. Ask before changing any production behavior. Show the tests that demonstrate safe rollback.

The orchestrator can investigate read-only, delegate edits and tests to a worker, or assign a planner, executor or reviewer to coordinate a larger set of tasks. Independent tasks can run in parallel. Check the evidence in the final response, especially when acceptance depends on a specific test or environment. A finished child task only establishes that its execution finished.

If routing asks you to pick a candidate, tell the orchestrator which offered option to use for the existing task. A new request would start a separate task and decision.

## Answer a question about your project

A managed worker or department can ask its parent when essential information is missing. A parent can answer from the task brief or project evidence and send the reply back on the same task. When necessary, it can ask a configured advisor to reason about the options.

An unanswered child question reaches the root orchestrator after the configured timeout. The orchestrator asks you through OpenCode's question UI when it needs a decision or fact specific to you. For example, it can explain that keeping the old column for one release makes rollback possible and ask whether that retention period meets your requirements. Your answer flows back to the existing child task. Tell the orchestrator if an assumption should govern the rest of the work.

## Ask for an independent opinion

Use `/advisor-pool` to approve models for consultation in this project. Choose a model with documented strengths relevant to the kind of review you need. It must be connected, enabled under `/providers`, allowed by `/pool`, and distinct from the requesting chat's model. An empty advisor pool disables consultation. The general pool allows all models when it is empty.

The orchestrator can ask for advice before a hard-to-reverse decision, when a failure has competing explanations, or when reviewers disagree. You can also ask for a bounded review:

> Before committing to a migration strategy, ask one advisor for the strongest argument against the proposed plan. If the evidence is still split, get one independent second opinion and explain what would change the decision.

Each advisor receives a short question and its supporting evidence. A second opinion can require a different model from the first. The orchestrator weighs the advice, checks decisive claims and owns the final recommendation. If no distinct approved model is eligible, the chat can continue with the evidence it already has. Advisors are read-only. They can incur generation charges under their provider account, separately from Jev's routing budget.

## Continue after a provider rejection

When a newly started worker is explicitly rejected for a rate limit or insufficient balance before it has produced output or recorded usage, opened a form, used a tool, or started child work, momo can continue the same task once with an eligible economical alternative. The alternate must meet the task's constraints and current pool policy. momo requires known input and output rates at or below the original model's rates, or a verified free alternative.

The task keeps its identity. The alternate uses a new worker session, and task details show the original model, rejection and attempt. A temporary rejection cools down before that model is eligible again. If no alternate qualifies and the 429 response includes an explicit `Retry-After` of 15 minutes or less, the task can stay queued for one retry of the original model after that delay. The queued retry survives an OpenCode restart and can resume for up to two minutes after its scheduled time. The original model must still meet the task's recorded price and pool constraints when it runs. Without that bounded header, the task stops and reports that you can wait for cooldown or adjust the pool. Insufficient-balance rejections without an alternate require you to restore funding or change the pool. When the original attempt may have started work, inspect its session and any changes before retrying.

## Switch roles in the same chat

Use OpenCode's agent picker to switch between **momo-orchestrator**, **momo-planner** and **momo-worker**. In the TUI, the default binding in OpenCode v2.4.2 is `Shift+Tab` to cycle agents. The same chat keeps its conversation, decisions and pending work. The new role receives a transition notice and uses its own permissions from then on.

- **Orchestrator** owns the full task, coordinates work and asks you for decisions when needed.
- **Planner** inspects the project and builds a read-only plan with acceptance checks.
- **Worker** edits files and runs commands directly. Choose it when you want to work through the plan in this chat.

For the migration example, switch to planner to work out rollout steps and checks. Switch to worker after choosing a plan, then return to orchestrator to review the evidence and resolve pending questions.

For installation, configuration and the details of costs and routing, see the [momo README](../../README.md).
