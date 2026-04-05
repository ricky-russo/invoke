export interface ProviderConfig {
    cli: string;
    args: string[];
}
export interface ProviderEntry {
    provider: string;
    model: string;
    effort: 'low' | 'medium' | 'high';
    timeout?: number;
}
export type ProviderMode = 'parallel' | 'fallback' | 'single';
export interface RoleConfig {
    prompt: string;
    providers: ProviderEntry[];
    provider_mode?: ProviderMode;
}
export interface StrategyConfig {
    prompt: string;
}
export interface ReviewTier {
    name: string;
    reviewers: string[];
}
export interface Settings {
    default_strategy: string;
    agent_timeout: number;
    commit_style: 'one-commit' | 'per-batch' | 'per-task' | 'custom';
    work_branch_prefix: string;
    preset?: string;
    stale_session_days?: number;
    post_merge_commands?: string[];
    max_parallel_agents?: number;
    default_provider_mode?: ProviderMode;
    max_dispatches?: number;
    max_review_cycles?: number;
    review_tiers?: ReviewTier[];
}
export interface PresetConfig {
    name?: string;
    description?: string;
    settings?: Partial<Settings>;
    researcher_selection?: string[];
    reviewer_selection?: string[];
    strategy_selection?: string[];
}
export interface InvokeConfig {
    providers: Record<string, ProviderConfig>;
    roles: Record<string, Record<string, RoleConfig>>;
    strategies: Record<string, StrategyConfig>;
    settings: Settings;
    presets?: Record<string, PresetConfig>;
}
export interface StrategyDetection {
    strategy: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
}
export interface DispatchRequest {
    role: string;
    subrole: string;
    taskContext: Record<string, string>;
    workDir?: string;
}
export interface AgentResult {
    role: string;
    subrole: string;
    provider: string;
    model: string;
    status: 'success' | 'error' | 'timeout';
    output: {
        summary: string;
        findings?: Finding[];
        report?: string;
        changes?: FileChange[];
        raw?: string;
    };
    duration: number;
}
export interface DispatchMetric {
    pipeline_id: string | null;
    stage: string;
    role: string;
    subrole: string;
    provider: string;
    model: string;
    effort: 'low' | 'medium' | 'high';
    prompt_size_chars: number;
    duration_ms: number;
    status: 'success' | 'error' | 'timeout';
    started_at: string;
    estimated_input_tokens?: number;
    estimated_output_tokens?: number;
    estimated_cost_usd?: number;
    output_size_chars?: number;
}
export interface MetricsSummary {
    total_dispatches: number;
    total_prompt_chars: number;
    total_duration_ms: number;
    total_estimated_cost_usd: number;
    by_stage: Record<string, {
        dispatches: number;
        duration_ms: number;
        prompt_chars: number;
        estimated_cost_usd: number;
    }>;
    by_provider_model: Record<string, {
        dispatches: number;
        duration_ms: number;
        prompt_chars: number;
        estimated_cost_usd: number;
    }>;
}
export interface Finding {
    issue: string;
    severity: 'critical' | 'high' | 'medium' | 'low';
    file: string;
    line?: number;
    suggestion: string;
    agreedBy?: string[];
}
export interface FileChange {
    file: string;
    action: 'created' | 'modified' | 'deleted';
    summary: string;
}
export interface BatchRequest {
    tasks: BatchTask[];
    createWorktrees: boolean;
    maxParallel?: number;
}
export interface BatchTask {
    taskId: string;
    role: string;
    subrole: string;
    taskContext: Record<string, string>;
    depends_on?: string[];
}
export interface BatchStatus {
    batchId: string;
    status: 'running' | 'partial' | 'completed' | 'error' | 'cancelled';
    agents: AgentStatus[];
}
export interface AgentStatus {
    taskId: string;
    status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout';
    result?: AgentResult;
}
export interface PipelineState {
    pipeline_id: string;
    started: string;
    last_updated: string;
    current_stage: 'scope' | 'plan' | 'orchestrate' | 'build' | 'review' | 'complete';
    work_branch?: string;
    spec?: string;
    plan?: string;
    strategy?: string;
    batches: BatchState[];
    review_cycles: ReviewCycle[];
}
export interface BatchState {
    id: number;
    status: 'pending' | 'in_progress' | 'partial' | 'completed' | 'error';
    tasks: TaskState[];
}
export interface TaskState {
    id: string;
    status: 'pending' | 'dispatched' | 'running' | 'completed' | 'error' | 'timeout';
    worktree_path?: string;
    worktree_branch?: string;
    result_summary?: string;
    result_status?: 'success' | 'error' | 'timeout';
    depends_on?: string[];
    merged?: boolean;
}
export interface ReviewCycle {
    id: number;
    reviewers: string[];
    findings: Finding[];
    batch_id?: number;
    scope?: 'batch' | 'final';
    tier?: string;
    triaged?: {
        accepted: Finding[];
        dismissed: Finding[];
    };
}
export interface SessionInfo {
    session_id: string;
    pipeline_id: string;
    current_stage: string;
    started: string;
    last_updated: string;
    status: 'active' | 'complete' | 'stale';
}
export interface SessionStageComparison {
    dispatches: number;
    duration_ms: number;
    prompt_chars: number;
    estimated_cost_usd: number;
}
export interface SessionComparisonEntry {
    session_id: string;
    total_dispatches: number;
    total_duration_ms: number;
    total_prompt_chars: number;
    total_estimated_cost_usd: number;
    by_stage: Record<string, SessionStageComparison>;
}
export interface SessionComparisonDelta {
    dispatches: number;
    duration_ms: number;
    prompt_chars: number;
    estimated_cost_usd: number;
}
export interface SessionComparison {
    sessions: SessionComparisonEntry[];
    delta: SessionComparisonDelta | null;
}
//# sourceMappingURL=types.d.ts.map