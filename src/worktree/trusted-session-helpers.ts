import { execFileSync } from 'child_process'
import { realpathSync } from 'fs'
import os from 'os'
import path from 'path'

export const INVOKE_SESSION_BASENAME_PREFIX = 'invoke-session-'

// Note: realpath(os.tmpdir()) is intentionally NOT memoized. The call is cheap
// (single syscall), and caching it would break tests that mock os.tmpdir() via
// vi.spyOn — once cached, subsequent calls would see the stale mocked value.
function getTmpdirRealpath(): string {
  try {
    return realpathSync(os.tmpdir())
  } catch {
    return os.tmpdir()
  }
}

/**
 * Resolves the canonical realpath of `git rev-parse --git-common-dir` for the
 * given cwd. Returns null on any failure (failure-safe).
 *
 * This function is deliberately NOT memoized at module scope. A previous
 * version kept a `Map<cwd, resolved>` cache, but it was a "poisoned-on-first-
 * read" hazard: if an attacker swapped the path (symlink replacement, worktree
 * moved, repo re-initialized) between the benign first read and a later safety
 * check, the cache would keep returning the stale common-dir and approve the
 * swap. Callers that need to avoid repeated git invocations within a single
 * logical check should use a per-call memo (see `resolveSafeSessionWorkBranchPath`
 * which passes one in).
 */
export function resolveGitCommonDir(
  cwd: string,
  memo?: Map<string, string>
): string | null {
  if (memo) {
    const cached = memo.get(cwd)
    if (cached !== undefined) return cached
  }
  try {
    const output = execFileSync('git', ['rev-parse', '--git-common-dir'], {
      cwd,
      stdio: 'pipe',
    })
      .toString()
      .trim()
    // Output may be relative (e.g. '.git'); resolve against cwd first.
    const resolved = realpathSync(path.resolve(cwd, output))
    if (memo) memo.set(cwd, resolved)
    return resolved
  } catch {
    return null
  }
}

/**
 * Returns true when workBranch is exactly the canonical session work branch
 * for sessionId under workBranchPrefix (i.e. `${prefix}/${sessionId}`).
 */
export function isSafeWorkBranch(
  workBranch: string | undefined,
  sessionId: string,
  workBranchPrefix: string
): workBranch is string {
  if (!workBranch) return false
  return workBranch === `${workBranchPrefix}/${sessionId}`
}

/**
 * Type guard: returns true only when workBranchPath is a real session worktree
 * for the given repoDir. Checks (in order):
 *   1. workBranchPath is a defined absolute path
 *   2. realpath(workBranchPath) is under realpath(os.tmpdir())
 *   3. basename of realpath starts with INVOKE_SESSION_BASENAME_PREFIX
 *   4. git rev-parse --git-common-dir for both workBranchPath and repoDir resolves to the same realpath
 *
 * Prefer `resolveSafeSessionWorkBranchPath` when you need to use the path after
 * the check — it returns the canonical path that was validated so callers do
 * not have to re-resolve the pathname (which opens a TOCTOU window).
 */
export function isSafeSessionWorkBranchPath(
  workBranchPath: string | undefined,
  repoDir: string
): workBranchPath is string {
  return resolveSafeSessionWorkBranchPath(workBranchPath, repoDir) !== null
}

/**
 * Same checks as `isSafeSessionWorkBranchPath` but returns the canonical
 * (realpath-resolved) path on success, or null on failure. Callers should
 * prefer this over the type guard whenever they intend to use the path,
 * because it returns the EXACT path that was validated. Re-resolving via a
 * second `realpathSync` introduces a check-to-use TOCTOU window where an
 * attacker with tmpdir write access could swap a symlink between the check
 * and the use.
 */
export function resolveSafeSessionWorkBranchPath(
  workBranchPath: string | undefined,
  repoDir: string
): string | null {
  if (!workBranchPath || !path.isAbsolute(workBranchPath)) return null

  let canonicalTarget: string
  try {
    canonicalTarget = realpathSync(workBranchPath)
  } catch {
    return null
  }

  const canonicalTmp = getTmpdirRealpath()

  if (canonicalTarget !== canonicalTmp && !canonicalTarget.startsWith(canonicalTmp + path.sep)) {
    return null
  }

  if (!path.basename(canonicalTarget).startsWith(INVOKE_SESSION_BASENAME_PREFIX)) {
    return null
  }

  // Repo identity check via git common-dir. Use a per-call memo so the two
  // lookups inside this function share a result, without persisting beyond it.
  const memo = new Map<string, string>()
  const targetCommonDir = resolveGitCommonDir(canonicalTarget, memo)
  const repoCommonDir = resolveGitCommonDir(repoDir, memo)
  if (!targetCommonDir || !repoCommonDir) return null
  if (targetCommonDir !== repoCommonDir) return null

  return canonicalTarget
}
