import { describe, expect, it } from 'vitest'
import { buildExecutionLayers } from '../../src/dispatch/dag-scheduler.js'

describe('buildExecutionLayers', () => {
  it('returns an empty array for empty input', () => {
    expect(buildExecutionLayers([])).toEqual([])
  })

  it('groups tasks with no dependencies into a single layer', () => {
    const tasks = [
      { id: 'A', role: 'builder' },
      { id: 'B', role: 'reviewer' },
      { id: 'C', role: 'tester' },
    ]

    expect(buildExecutionLayers(tasks)).toEqual([tasks])
  })

  it('creates one layer per task for linear dependencies', () => {
    const tasks = [
      { id: 'A' },
      { id: 'B', depends_on: ['A'] },
      { id: 'C', depends_on: ['B'] },
    ]

    expect(buildExecutionLayers(tasks)).toEqual([[tasks[0]], [tasks[1]], [tasks[2]]])
  })

  it('creates parallel middle layers for diamond dependencies', () => {
    const tasks = [
      { id: 'A' },
      { id: 'B', depends_on: ['A'] },
      { id: 'C', depends_on: ['A'] },
      { id: 'D', depends_on: ['B', 'C'] },
    ]

    expect(buildExecutionLayers(tasks)).toEqual([[tasks[0]], [tasks[1], tasks[2]], [tasks[3]]])
  })

  it('throws for circular dependencies', () => {
    expect(() =>
      buildExecutionLayers([
        { id: 'A', depends_on: ['B'] },
        { id: 'B', depends_on: ['A'] },
      ])
    ).toThrowError('Circular dependency detected in task graph')
  })

  it('throws for unknown dependency references', () => {
    expect(() =>
      buildExecutionLayers([
        { id: 'A', depends_on: ['B'] },
      ])
    ).toThrowError('Task A depends on unknown task B')
  })

  it('throws for duplicate task IDs', () => {
    expect(() =>
      buildExecutionLayers([
        { id: 'A' },
        { id: 'A' },
      ])
    ).toThrowError('Duplicate task ID detected: A')
  })
})
