import lockfile from 'proper-lockfile';
export async function withLock(filePath, fn) {
    const release = await lockfile.lock(filePath, {
        stale: 30000,
        retries: { retries: 5, minTimeout: 100, maxTimeout: 1000 },
    });
    try {
        return await fn();
    }
    finally {
        await release();
    }
}
//# sourceMappingURL=lock.js.map