import { execSync } from 'child_process'

export interface BaseBranchCandidates {
  currentHead: string | null
  defaultBranch: string | null
  allLocalBranches: string[]
}

function shellEscape(value: string): string {
  return value.replace(/(["\\$`])/g, '\\$1')
}

function runGit(repoDir: string, command: string): string {
  return execSync(command, {
    cwd: repoDir,
    stdio: 'pipe',
  }).toString().trim()
}

function tryRunGit(repoDir: string, command: string): string | null {
  try {
    return runGit(repoDir, command)
  } catch {
    return null
  }
}

export function branchExists(repoDir: string, branch: string): boolean {
  try {
    execSync(
      `git show-ref --verify "refs/heads/${shellEscape(branch)}"`,
      {
        cwd: repoDir,
        stdio: 'pipe',
      }
    )
    return true
  } catch {
    return false
  }
}

function discoverDefaultBranch(repoDir: string): string | null {
  const originHead = tryRunGit(repoDir, 'git symbolic-ref refs/remotes/origin/HEAD')
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
  const currentHead = tryRunGit(repoDir, 'git symbolic-ref --short HEAD')
  const allLocalBranchesOutput = runGit(
    repoDir,
    `git for-each-ref --format='%(refname:short)' refs/heads/`
  )

  return {
    currentHead,
    defaultBranch: discoverDefaultBranch(repoDir),
    allLocalBranches: allLocalBranchesOutput
      ? allLocalBranchesOutput.split('\n').filter(Boolean)
      : [],
  }
}
