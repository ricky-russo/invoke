export function buildExecutionLayers(tasks) {
    if (tasks.length === 0)
        return [];
    const taskMap = new Map();
    const inDegree = new Map();
    const dependents = new Map();
    for (const task of tasks) {
        taskMap.set(task.id, task);
        inDegree.set(task.id, 0);
        dependents.set(task.id, []);
    }
    for (const task of tasks) {
        for (const dependencyId of task.depends_on ?? []) {
            if (!taskMap.has(dependencyId)) {
                throw new Error(`Task ${task.id} depends on unknown task ${dependencyId}`);
            }
            inDegree.set(task.id, inDegree.get(task.id) + 1);
            dependents.get(dependencyId).push(task.id);
        }
    }
    const layers = [];
    let currentLayer = tasks.filter(task => inDegree.get(task.id) === 0);
    let scheduledCount = 0;
    while (currentLayer.length > 0) {
        layers.push(currentLayer);
        scheduledCount += currentLayer.length;
        const nextLayer = [];
        for (const task of currentLayer) {
            for (const dependentId of dependents.get(task.id) ?? []) {
                const nextInDegree = inDegree.get(dependentId) - 1;
                inDegree.set(dependentId, nextInDegree);
                if (nextInDegree === 0) {
                    nextLayer.push(taskMap.get(dependentId));
                }
            }
        }
        currentLayer = nextLayer;
    }
    if (scheduledCount < tasks.length) {
        throw new Error('Circular dependency detected in task graph');
    }
    return layers;
}
//# sourceMappingURL=dag-scheduler.js.map