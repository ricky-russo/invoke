import { describe, it, expect } from 'vitest'
import { readFile } from 'fs/promises'
import path from 'path'

const STRATEGIES = ['bug-fix.md', 'implementation-first.md', 'prototype.md', 'tdd.md'] as const

describe('default strategies', () => {
  it.each(STRATEGIES)('.invoke/ strategy is byte-for-byte identical to defaults/: %s', async (file) => {
    const defaultsPath = path.join(import.meta.dirname, '..', 'defaults', 'strategies', file)
    const invokePath = path.join(import.meta.dirname, '..', '.invoke', 'strategies', file)
    const defaultsContent = await readFile(defaultsPath, 'utf-8')
    const invokeContent = await readFile(invokePath, 'utf-8')

    expect(invokeContent).toBe(defaultsContent)
  })
})
