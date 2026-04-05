export interface DAGTask {
  id: string
  depends_on?: string[]
}

export function buildExecutionLayers<T extends DAGTask>(tasks: T[]): T[][] {
  if (tasks.length === 0) return []

  const taskMap = new Map<string, T>()
  const inDegree = new Map<string, number>()
  const dependents = new Map<string, string[]>()

  for (const task of tasks) {
    if (taskMap.has(task.id)) {
      throw new Error(`Duplicate task ID detected: ${task.id}`)
    }

    taskMap.set(task.id, task)
    inDegree.set(task.id, 0)
    dependents.set(task.id, [])
  }

  for (const task of tasks) {
    for (const dependencyId of task.depends_on ?? []) {
      if (!taskMap.has(dependencyId)) {
        throw new Error(`Task ${task.id} depends on unknown task ${dependencyId}`)
      }

      inDegree.set(task.id, inDegree.get(task.id)! + 1)
      dependents.get(dependencyId)!.push(task.id)
    }
  }

  const layers: T[][] = []
  let currentLayer = tasks.filter(task => inDegree.get(task.id) === 0)
  let scheduledCount = 0

  while (currentLayer.length > 0) {
    layers.push(currentLayer)
    scheduledCount += currentLayer.length

    const nextLayer: T[] = []

    for (const task of currentLayer) {
      for (const dependentId of dependents.get(task.id) ?? []) {
        const nextInDegree = inDegree.get(dependentId)! - 1
        inDegree.set(dependentId, nextInDegree)

        if (nextInDegree === 0) {
          nextLayer.push(taskMap.get(dependentId)!)
        }
      }
    }

    currentLayer = nextLayer
  }

  if (scheduledCount < tasks.length) {
    throw new Error('Circular dependency detected in task graph')
  }

  return layers
}
