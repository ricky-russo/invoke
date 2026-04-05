export interface DAGTask {
    id: string;
    depends_on?: string[];
}
export declare function buildExecutionLayers<T extends DAGTask>(tasks: T[]): T[][];
//# sourceMappingURL=dag-scheduler.d.ts.map