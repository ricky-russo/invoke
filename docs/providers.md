# Provider Setup

This guide explains how to configure provider CLIs in `.invoke/pipeline.yaml`.
A provider is a named command template.
It has a `cli` string and an `args` array.
Each role subrole selects one or more provider entries.
Each entry includes a `provider`, `model`, `effort`, and optional `timeout`.
At dispatch time, invoke interpolates `{{model}}` and `{{effort}}`.
It appends the rendered prompt.
It then launches the command in the selected working directory.
If a provider is not a built-in special case, invoke still runs it generically.

## Overview

Providers connect invoke roles to AI CLIs.
You define the command once under `providers:`.
You then reference that provider name from role entries under `roles:`.
This separation keeps role prompts reusable across different CLIs.

The shipped pipeline template includes three provider definitions.
They are `claude`, `codex`, and `gemini`.
The global default provider mode is `parallel`.
Any subrole with exactly one configured provider still resolves to `single` at runtime.

## Claude Setup

The shipped Claude provider definition is:

```yaml
providers:
  claude:
    cli: claude
    args: ["--print", "--model", "{{model}}", "--dangerously-skip-permissions"]
```

These args come directly from the default pipeline template.
Invoke replaces `{{model}}` from the selected role entry.
It appends the rendered prompt as the last argument.
It then runs `claude` in the task working directory.

The default command includes `--dangerously-skip-permissions` on every Claude dispatch.
Treat that as an explicit trust decision.
The shipped setup opts into a `dangerously-*` mode.
That mode skips provider-side permission gating.
It fits trusted repositories and prompts better than untrusted inputs.

## Codex Setup

The shipped Codex provider definition is:

```yaml
providers:
  codex:
    cli: codex
    args: ["--dangerously-bypass-approvals-and-sandbox", "exec", "--model", "{{model}}", "-c", "reasoning_effort={{effort}}"]
```

These args also come directly from the default pipeline template.
Invoke replaces `{{model}}` and `{{effort}}`.
It then adds `--skip-git-repo-check` and the rendered prompt.
The effective command shape is `codex --dangerously-bypass-approvals-and-sandbox exec --model <model> -c reasoning_effort=<effort> --skip-git-repo-check <prompt>`.

`exec` is the subcommand in the shipped Codex setup.
`reasoning_effort={{effort}}` maps the role-level `effort` value into the Codex command line.
The supported values are `low`, `medium`, and `high`.

The default file explains why `--dangerously-bypass-approvals-and-sandbox` is present.
The shipped Codex args bypass the Codex sandbox layer.
That layer would otherwise cover network and filesystem access.
Invoke still creates a temporary git worktree for each builder task.
It runs Codex from that worktree path.
That isolates Git state for the task.
It does not add filesystem or network containment.
Keep that default only if that trust model matches your environment.

## Gemini Setup

The shipped Gemini provider definition is:

```yaml
providers:
  gemini:
    cli: gemini
    args: ["-y", "--output-format", "text", "-m", "{{model}}", "-p"]
```

Gemini is handled from config rather than by a special built-in command shape.
Invoke uses the configured args as written.
It replaces `{{model}}`.
It appends the rendered prompt as the final argument.
With the shipped defaults, the command shape is `gemini -y --output-format text -m <model> -p <prompt>`.

In practice, invoke always passes `-y`.
It asks Gemini for `text` output.
It places the rendered prompt immediately after `-p`.
That text-oriented setup matches invoke's standard parser path.
The parser consumes raw text output.
For reviewer roles, it extracts findings from Markdown-style sections.

## Adding a Custom Provider

Any CLI can be a provider.
You only need a `cli` plus an `args` array.
You then reference that provider name from a role entry.
Invoke validates that the configured CLI exists on `PATH`.
It only checks providers that are actually used by a role.

Use this shape:

```yaml
providers:
  local-ai:
    cli: local-ai
    args: ["review", "--model", "{{model}}", "--effort", "{{effort}}", "--prompt"]

roles:
  reviewer:
    security:
      prompt: .invoke/roles/reviewer/security.md
      provider_mode: fallback
      providers:
        - provider: local-ai
          model: local-ai-pro
          effort: medium
          timeout: 300
```

If your CLI expects the prompt as a flag value, put that flag at the end of `args`.
Invoke appends the rendered prompt after the configured args.
If the provider name or CLI is not a built-in special case, invoke still registers it.
It uses the configured args generically.

## Provider Modes

`provider_mode` matters when a subrole has more than one `providers[]` entry.
Resolution order is:

1. `roles.<group>.<subrole>.provider_mode`
2. `settings.default_provider_mode`
3. `parallel`

If a subrole has exactly one provider entry, invoke forces `single` at runtime.
The shipped template also notes what `provider_mode` controls.
It can run all providers concurrently.
It can try them in order.
It can also use only the first one.

- `parallel` runs every configured provider at the same time.
- It then merges the results.
- For reviewer findings, duplicates are collapsed by file and line or by issue-text overlap.
- When providers disagree, the higher severity wins.
- `agreedBy` records which providers found the same issue independently.
- Use this when cross-checking matters more than cost.
- `fallback` tries providers in order.
- It stops at the first successful result.
- If they all fail, invoke returns the last failure result.
- Use this when you want resilience without paying for every run.
- `single` dispatches only `providers[0]`.
- Use this for the cheapest and most predictable path.
- It also fits cases where you do not need cross-provider agreement.

## Security Considerations

The shipped Claude and Codex defaults both include `dangerously-*` flags.
The default provider commands are not conservative.
Claude uses `--dangerously-skip-permissions`.
Codex uses `--dangerously-bypass-approvals-and-sandbox`.

Use those defaults only when you trust the repository, the prompts, and the local environment.
For Codex, invoke gives each builder task its own Git worktree and branch context.
The default Codex args still bypass the provider sandbox.
That sandbox would otherwise cover filesystem and network access.
This can be reasonable for controlled local development.
It is a poor fit for untrusted repositories or prompts.

If you want a stricter setup, define a second provider entry with different args.
Point only selected roles at it.
Providers are config-driven.
You can keep a fast local profile and a more restrictive profile side by side.

## Cost Guidance

Invoke estimates cost per dispatch from prompt size, output size, and a per-model pricing table.
Each dispatch metric can record estimated input tokens, output tokens, and cost in USD.
More provider runs create more token usage.
They also create more estimated cost records.

Provider mode has a direct cost effect.
`parallel` sends the same prompt to every configured provider.
Cost scales with the number of providers you fan out to.
`fallback` usually costs less than `parallel`.
It stops on the first success.
`single` is the lowest-cost mode.
It launches only one provider.
The default pipeline template calls this out explicitly.
Single-provider runs are cheaper than dual-provider runs.
Its cost guide also compares Claude Opus and Claude Sonnet pricing.

For cost-sensitive roles, prefer `single`.
Reserve `parallel` for reviewer or decision-heavy roles.
Use `fallback` when you want a backup provider without paying for every run.
