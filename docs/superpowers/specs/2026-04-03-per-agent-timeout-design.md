# Per-Agent Timeout with Seconds Unit

**Date:** 2026-04-03
**Status:** Draft

## Goal

Allow per-provider-entry timeout configuration in pipeline.yaml, and switch the timeout unit from milliseconds to seconds for readability.

## Problem

All agents share a single `agent_timeout` (currently 300000ms / 5 minutes). Research agents analyzing a full codebase need more time than a builder writing a single file, but there's no way to configure this per-agent. The millisecond unit also produces unreadable numbers.

## Requirements

### Per-entry timeout

Add an optional `timeout` field (in seconds) on each provider entry in a role:

```yaml
roles:
  researcher:
    codebase:
      prompt: .invoke/roles/researcher/codebase.md
      providers:
        - provider: claude
          model: claude-opus-4-6
          effort: high
          timeout: 600
```

When omitted, falls back to `settings.agent_timeout`.

### Unit change to seconds

Switch `settings.agent_timeout` from milliseconds to seconds:

```yaml
settings:
  agent_timeout: 300   # was 300000
```

All timeout values throughout the system are in seconds. The dispatch engine converts to milliseconds internally when passing to `setTimeout`/`runProcess`.

### Default timeouts in pipeline.yaml

Update `defaults/pipeline.yaml` with role-appropriate timeouts:

| Role | Default timeout |
|---|---|
| researcher | 600 (10 min) |
| planner | 600 (10 min) |
| builder | 300 (5 min) |
| reviewer | 300 (5 min) |

Global fallback `agent_timeout: 300`.

## Architecture

### File changes

| File | Change |
|---|---|
| `src/types.ts` | Add optional `timeout?: number` to `ProviderEntry` |
| `src/config.ts` | Add optional `timeout` to Zod schema for provider entries |
| `src/dispatch/engine.ts` | Use `entry.timeout ?? config.settings.agent_timeout`, convert seconds → ms when calling `runProcess` |
| `defaults/pipeline.yaml` | Add per-entry timeouts, change global to seconds |
| `tests/dispatch/engine.test.ts` | Test per-entry timeout override and seconds conversion |
| `src/config-validator.ts` | Validate timeout is a positive number when present |

### Conversion point

The `dispatchToProvider` method in `engine.ts` is the single place where timeout is consumed. Currently line 85:

```ts
this.config.settings.agent_timeout
```

Becomes:

```ts
(entry.timeout ?? this.config.settings.agent_timeout) * 1000
```

The `* 1000` converts seconds to milliseconds for `setTimeout`. This is the only conversion point — the entire config layer and user-facing display use seconds.

## Constraints

- No backwards compatibility for millisecond values — clean break to seconds
- Per-entry timeout is optional — omitting falls back to global
- Validation should warn if a timeout value looks like it might be in milliseconds (> 3600, i.e. over an hour)

## Acceptance criteria

- [ ] Provider entries accept an optional `timeout` field in seconds
- [ ] Per-entry timeout overrides global `agent_timeout` when present
- [ ] Global `agent_timeout` is in seconds (300 = 5 minutes)
- [ ] Dispatch engine converts seconds to milliseconds internally
- [ ] Default pipeline.yaml has per-entry timeouts (600 for research/planning, 300 for build/review)
- [ ] Validator warns on suspiciously large timeout values (> 3600)
- [ ] Existing tests pass

## Out of scope

- Dynamic timeout adjustment based on task complexity
- Per-provider (as opposed to per-entry) default timeouts
