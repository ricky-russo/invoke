'use strict'

const { open, stat, unlink } = require('fs/promises')

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeRetries(retries) {
  if (typeof retries === 'number') {
    return {
      retries,
      minTimeout: 0,
      maxTimeout: 0,
    }
  }

  return {
    retries: retries?.retries ?? 0,
    minTimeout: retries?.minTimeout ?? 0,
    maxTimeout: retries?.maxTimeout ?? retries?.minTimeout ?? 0,
  }
}

async function tryAcquire(lockPath, stale) {
  try {
    return await open(lockPath, 'wx')
  } catch (error) {
    if (error && error.code !== 'EEXIST') {
      throw error
    }

    if (!stale) {
      return null
    }

    try {
      const lockStat = await stat(lockPath)
      if (Date.now() - lockStat.mtimeMs <= stale) {
        return null
      }
    } catch (statError) {
      if (statError && statError.code === 'ENOENT') {
        return tryAcquire(lockPath, stale)
      }

      throw statError
    }

    try {
      await unlink(lockPath)
    } catch (unlinkError) {
      if (!unlinkError || unlinkError.code !== 'ENOENT') {
        throw unlinkError
      }
    }

    return tryAcquire(lockPath, stale)
  }
}

async function lock(filePath, options = {}) {
  const lockPath = `${filePath}.lock`
  const retries = normalizeRetries(options.retries)

  for (let attempt = 0; ; attempt += 1) {
    const handle = await tryAcquire(lockPath, options.stale)

    if (handle) {
      let released = false

      return async () => {
        if (released) {
          return
        }

        released = true
        await handle.close()

        try {
          await unlink(lockPath)
        } catch (error) {
          if (!error || error.code !== 'ENOENT') {
            throw error
          }
        }
      }
    }

    if (attempt >= retries.retries) {
      const error = new Error(`Lock is already held for ${filePath}`)
      error.code = 'ELOCKED'
      throw error
    }

    const delay = Math.min(
      retries.minTimeout * 2 ** attempt || retries.maxTimeout,
      retries.maxTimeout || retries.minTimeout
    )

    await sleep(delay)
  }
}

module.exports = {
  lock,
}
