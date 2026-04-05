import lockfile from 'proper-lockfile'

export async function withLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const release = await lockfile.lock(filePath, {
    realpath: false,
    stale: 30000,
    retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
  })

  try {
    return await fn()
  } finally {
    await release()
  }
}
