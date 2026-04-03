// -- Provider & Role Config --

export interface ProviderConfig {
  cli: string
  args: string[]
}

export interface ProviderEntry {
  provider: string
  model: string
  effort: 'low' | 'medium' | 'high'
  timeout?: number
}

export interface RoleConfig {
  prompt: string
  providers: ProviderEntry[]
}

export interface StrategyConfig {
  prompt: string
}

export interface Settings {
  default_strategy: string
  agent_timeout: number
  commit_style: 'one-commit' | 'per-batch' | 'per-task' | 'custom'
  work_branch_prefix: string
  post_merge_commands?: string[]
}

export interface InvokeConfig {
  providers: Record<string, ProviderConfig>
  roles: Record<string, Record<string, RoleConfig>>
  strategies: Record<string, StrategyConfig>
  settings: Settings
}

// -- Agent Dispatch & Results --

export interface DispatchRequest {
  role: string
  subrole: string
  taskContext: Record<string, string>
  workDir?: string
}

export interface AgentResult {
  role: string
  subrole: string
  provider: string
  model: string
  status: 'success' | 'error' | 'timeout'
  output: {
    summary: string
    findings?: Finding[]
    report?: string
    changes?: FileChange[]
    raw?: string
  }
  duration: number
}

export interface Finding {
  issue: string
  severity: 'critical' | 'high' | 'medium' | 'low'
  file: string
  line?: number
  suggestion: string
  agreedBy?: string[]
}

export interface FileChange {
  file: string
  action: 'created' | 'modified' | 'deleted'
  summary: string
}

// -- Batch Dispatch --

export interface BatchRequest {
  tasks: BatchTask[]
  createWorktrees: boolean
}

export interface BatchTask {
  taskId: string
  role: string
  subrole: string
  taskContext: Record<string, string>
}

export interface BatchStatus {
  batchId: string
  status: 'running' | 'completed' | 'error' | 'cancelled'
  agents: AgentStatus[]
}

export interface AgentStatus {
  taskId: string
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout'
  result?: AgentResult
}

// -- Pipeline State --

export interface PipelineState {
  pipeline_id: string
  started: string
  last_updated: string
  current_stage: 'scope' | 'plan' | 'orchestrate' | 'build' | 'review' | 'complete'
  work_branch?: string
  spec?: string
  plan?: string
  strategy?: string
  batches: BatchState[]
  review_cycles: ReviewCycle[]
}

export interface BatchState {
  id: number
  status: 'pending' | 'in_progress' | 'completed' | 'error'
  tasks: TaskState[]
}

export interface TaskState {
  id: string
  status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout'
  worktree_path?: string
  worktree_branch?: string
  result_summary?: string
  result_status?: 'success' | 'error' | 'timeout'
}

export interface ReviewCycle {
  id: number
  reviewers: string[]
  findings: Finding[]
  triaged?: {
    accepted: Finding[]
    dismissed: Finding[]
  }
}
