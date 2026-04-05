import { describe, expect, it } from 'vitest'
import { compareSessions, formatComparisonTable } from '../../src/metrics/comparison.js'
import type { DispatchMetric } from '../../src/types.js'

function createMetric(overrides: Partial<DispatchMetric> = {}): DispatchMetric {
  return {
    pipeline_id: 'pipeline-123',
    stage: 'build',
    role: 'builder',
    subrole: 'default',
    provider: 'claude',
    model: 'opus-4.6',
    effort: 'medium',
    prompt_size_chars: 100,
    duration_ms: 250,
    status: 'success',
    started_at: '2026-04-04T12:00:00.000Z',
    ...overrides,
  }
}

describe('compareSessions', () => {
  it('returns session totals with a null delta for a single session', () => {
    const comparison = compareSessions(
      new Map([
        [
          'session-a',
          [
            createMetric({
              stage: 'build',
              prompt_size_chars: 120,
              duration_ms: 300,
              estimated_cost_usd: 0.05,
            }),
            createMetric({
              stage: 'review',
              provider: 'codex',
              model: 'gpt-5',
              prompt_size_chars: 80,
              duration_ms: 450,
              estimated_cost_usd: 0.1,
              status: 'error',
            }),
          ],
        ],
      ])
    )

    expect(comparison).toEqual({
      sessions: [
        {
          session_id: 'session-a',
          total_dispatches: 2,
          success_rate: 0.5,
          total_duration_ms: 750,
          total_prompt_chars: 200,
          total_estimated_cost_usd: 0.15,
          by_stage: {
            build: {
              dispatches: 1,
              duration_ms: 300,
              prompt_chars: 120,
              estimated_cost_usd: 0.05,
            },
            review: {
              dispatches: 1,
              duration_ms: 450,
              prompt_chars: 80,
              estimated_cost_usd: 0.1,
            },
          },
          by_provider_model: {
            'claude:opus-4.6': {
              dispatches: 1,
              duration_ms: 300,
              prompt_chars: 120,
              estimated_cost_usd: 0.05,
            },
            'codex:gpt-5': {
              dispatches: 1,
              duration_ms: 450,
              prompt_chars: 80,
              estimated_cost_usd: 0.1,
            },
          },
        },
      ],
      delta: null,
    })
  })

  it('returns per-session totals and a second-minus-first delta for two sessions', () => {
    const comparison = compareSessions(
      new Map([
        [
          'session-a',
          [
            createMetric({
              stage: 'build',
              prompt_size_chars: 100,
              duration_ms: 200,
              estimated_cost_usd: 0.05,
            }),
          ],
        ],
        [
          'session-b',
          [
            createMetric({
              stage: 'build',
              prompt_size_chars: 150,
              duration_ms: 350,
              estimated_cost_usd: 0.08,
            }),
            createMetric({
              stage: 'review',
              provider: 'codex',
              model: 'gpt-5',
              prompt_size_chars: 60,
              duration_ms: 150,
              status: 'error',
            }),
          ],
        ],
      ])
    )

    expect(comparison.sessions).toEqual([
      {
        session_id: 'session-a',
        total_dispatches: 1,
        success_rate: 1,
        total_duration_ms: 200,
        total_prompt_chars: 100,
        total_estimated_cost_usd: 0.05,
        by_stage: {
          build: {
            dispatches: 1,
            duration_ms: 200,
            prompt_chars: 100,
            estimated_cost_usd: 0.05,
          },
        },
        by_provider_model: {
          'claude:opus-4.6': {
            dispatches: 1,
            duration_ms: 200,
            prompt_chars: 100,
            estimated_cost_usd: 0.05,
          },
        },
      },
      {
        session_id: 'session-b',
        total_dispatches: 2,
        success_rate: 0.5,
        total_duration_ms: 500,
        total_prompt_chars: 210,
        total_estimated_cost_usd: 0.08,
        by_stage: {
          build: {
            dispatches: 1,
            duration_ms: 350,
            prompt_chars: 150,
            estimated_cost_usd: 0.08,
          },
          review: {
            dispatches: 1,
            duration_ms: 150,
            prompt_chars: 60,
            estimated_cost_usd: 0,
          },
        },
        by_provider_model: {
          'claude:opus-4.6': {
            dispatches: 1,
            duration_ms: 350,
            prompt_chars: 150,
            estimated_cost_usd: 0.08,
          },
          'codex:gpt-5': {
            dispatches: 1,
            duration_ms: 150,
            prompt_chars: 60,
            estimated_cost_usd: 0,
          },
        },
      },
    ])
    expect(comparison.delta).toEqual({
      dispatches: 1,
      dispatches_percentage: '100.0%',
      duration_ms: 300,
      duration_ms_percentage: '150.0%',
      prompt_chars: 110,
      prompt_chars_percentage: '110.0%',
      estimated_cost_usd: 0.03,
      estimated_cost_usd_percentage: '60.0%',
    })
  })

  it('returns a null delta when comparing three or more sessions', () => {
    const comparison = compareSessions(
      new Map([
        ['session-a', [createMetric({ duration_ms: 100 })]],
        ['session-b', [createMetric({ duration_ms: 200 })]],
        ['session-c', [createMetric({ duration_ms: 300 })]],
      ])
    )

    expect(comparison.sessions).toHaveLength(3)
    expect(comparison.delta).toBeNull()
  })

  it('returns N/A percentage deltas when the baseline session has zero totals', () => {
    const comparison = compareSessions(
      new Map([
        ['session-a', []],
        ['session-b', [createMetric({ duration_ms: 400, prompt_size_chars: 250, estimated_cost_usd: 0.2 })]],
      ])
    )

    expect(comparison.delta).toEqual({
      dispatches: 1,
      dispatches_percentage: 'N/A',
      duration_ms: 400,
      duration_ms_percentage: 'N/A',
      prompt_chars: 250,
      prompt_chars_percentage: 'N/A',
      estimated_cost_usd: 0.2,
      estimated_cost_usd_percentage: 'N/A',
    })
  })

  it('returns 0.0% percentage deltas when both sessions have zero totals', () => {
    const comparison = compareSessions(
      new Map([
        ['session-a', []],
        ['session-b', []],
      ])
    )

    expect(comparison.delta).toEqual({
      dispatches: 0,
      dispatches_percentage: '0.0%',
      duration_ms: 0,
      duration_ms_percentage: '0.0%',
      prompt_chars: 0,
      prompt_chars_percentage: '0.0%',
      estimated_cost_usd: 0,
      estimated_cost_usd_percentage: '0.0%',
    })
  })

  it('handles empty metrics arrays without errors', () => {
    const comparison = compareSessions(new Map([['session-empty', []]]))

    expect(comparison).toEqual({
      sessions: [
        {
          session_id: 'session-empty',
          total_dispatches: 0,
          success_rate: 0,
          total_duration_ms: 0,
          total_prompt_chars: 0,
          total_estimated_cost_usd: 0,
          by_stage: {},
          by_provider_model: {},
        },
      ],
      delta: null,
    })
  })
})

describe('formatComparisonTable', () => {
  it('renders a markdown table and includes a delta row when present', () => {
    const comparison = compareSessions(
      new Map([
        [
          'session-a',
          [
            createMetric({
              prompt_size_chars: 100,
              duration_ms: 200,
              estimated_cost_usd: 0.05,
            }),
          ],
        ],
        [
          'session-b',
          [
            createMetric({
              prompt_size_chars: 160,
              duration_ms: 500,
              estimated_cost_usd: 0.08,
            }),
          ],
        ],
      ])
    )

    expect(formatComparisonTable(comparison)).toBe(
      [
        '| Session | Dispatches | Success Rate | Duration | Prompt Chars | Est. Cost |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        '| session-a | 1 | 100.0% | 200 | 100 | 0.05 |',
        '| session-b | 1 | 100.0% | 500 | 160 | 0.08 |',
        '| Delta | 0 (0.0%) | 0.0 pts (0.0%) | 300 (150.0%) | 60 (60.0%) | 0.03 (60.0%) |',
      ].join('\n')
    )
  })

  it('renders success rate and N/A delta percentages when the baseline session is empty', () => {
    const comparison = compareSessions(
      new Map([
        ['session-a', []],
        ['session-b', [createMetric({ duration_ms: 300, prompt_size_chars: 150, estimated_cost_usd: 0.1 })]],
      ])
    )

    expect(formatComparisonTable(comparison)).toBe(
      [
        '| Session | Dispatches | Success Rate | Duration | Prompt Chars | Est. Cost |',
        '| --- | ---: | ---: | ---: | ---: | ---: |',
        '| session-a | 0 | 0.0% | 0 | 0 | 0 |',
        '| session-b | 1 | 100.0% | 300 | 150 | 0.1 |',
        '| Delta | 1 (N/A) | 100.0 pts (N/A) | 300 (N/A) | 150 (N/A) | 0.1 (N/A) |',
      ].join('\n')
    )
  })
})
