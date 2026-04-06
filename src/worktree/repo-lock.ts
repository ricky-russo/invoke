import { realpathSync } from 'fs'

const repoLocks = new Map<string, Promise<void>>()
const mergeTargetLocks = new Map<string, Promise<void>>()

async function runExclusive<T>(
  locks: Map<string, Promise<void>>,
  key: string,
  fn: () => Promise<T>
): Promise<T> {
  const previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>(resolve => {
    release = resolve
  })
  const tail = previous.catch(() => undefined).then(() => current)

  locks.set(key, tail)
  await previous.catch(() => undefined)

  try {
    return await fn()
  } finally {
    release()
    if (locks.get(key) === tail) {
      locks.delete(key)
    }
  }
}

/** Serializes operations that mutate the repo's worktree registry (git worktree add/remove/prune). Keyed by canonical repoDir. */
export async function withRepoLock<T>(repoDir: string, fn: () => Promise<T>): Promise<T> {
  return runExclusive(repoLocks, canonicalize(repoDir), fn)
}

/** Serializes operations that mutate the working tree at a specific path (merges, resets, commits). Keyed by canonical path. */
export async function withMergeTargetLock<T>(targetPath: string, fn: () => Promise<T>): Promise<T> {
  return runExclusive(mergeTargetLocks, canonicalize(targetPath), fn)
}

function canonicalize(targetPath: string): string {
  try {
    return realpathSync(targetPath)
  } catch {
    return targetPath
  }
}
