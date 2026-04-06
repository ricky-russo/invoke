import { execFileSync } from 'child_process'

export interface BaseBranchCandidates {
  currentHead: string | null
  defaultBranch: string | null
  allLocalBranches: string[]
}

function runGit(repoDir: string, args: string[]): string {
  return execFileSync('git', args, {
    cwd: repoDir,
    stdio: 'pipe',
  }).toString().trim()
}

function tryRunGit(repoDir: string, args: string[]): string | null {
  try {
    return runGit(repoDir, args)
  } catch {
    return null
  }
}

export function branchExists(repoDir: string, branch: string): boolean {
  try {
    execFileSync('git', ['show-ref', '--verify', `refs/heads/${branch}`], {
      cwd: repoDir,
      stdio: 'pipe',
    })
    return true
  } catch {
    return false
  }
}

function discoverDefaultBranch(repoDir: string): string | null {
  const originHead = tryRunGit(repoDir, ['symbolic-ref', 'refs/remotes/origin/HEAD'])
  if (originHead) {
    return originHead.replace(/^refs\/remotes\/origin\//, '')
  }

  if (branchExists(repoDir, 'main')) {
    return 'main'
  }

  if (branchExists(repoDir, 'master')) {
    return 'master'
  }

  return null
}

export function discoverBaseBranchCandidates(repoDir: string): BaseBranchCandidates {
  const currentHead = tryRunGit(repoDir, ['symbolic-ref', '--short', 'HEAD'])
  const allLocalBranchesOutput = runGit(repoDir, [
    'for-each-ref',
    '--format=%(refname:short)',
    'refs/heads/',
  ])

  return {
    currentHead,
    defaultBranch: discoverDefaultBranch(repoDir),
    allLocalBranches: allLocalBranchesOutput
      ? allLocalBranchesOutput.split('\n').filter(Boolean)
      : [],
  }
}
