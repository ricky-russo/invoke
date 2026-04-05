declare module 'proper-lockfile' {
  export interface LockRetryOptions {
    retries: number
    minTimeout: number
    maxTimeout: number
  }

  export interface LockOptions {
    stale?: number
    retries?: number | LockRetryOptions
    realpath?: boolean
  }

  export type Release = () => Promise<void>

  export function lock(filePath: string, options?: LockOptions): Promise<Release>

  declare const lockfile: {
    lock: typeof lock
  }

  export default lockfile
}
