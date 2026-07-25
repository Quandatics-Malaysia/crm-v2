import "server-only"
import { promises as fs } from "node:fs"
import path from "node:path"
import { randomUUID } from "node:crypto"
import { env } from "@/lib/env"

export type StoredObject = { key: string; size: number }

export interface StorageService {
  put(tenantId: string, fileName: string, data: Buffer | Uint8Array): Promise<StoredObject>
  get(key: string): Promise<Buffer>
  delete(key: string): Promise<void>
}

/** Local filesystem driver — bytes on a Docker-mounted volume. */
class LocalStorage implements StorageService {
  private base = path.resolve(env.STORAGE_LOCAL_DIR)

  private resolveSafe(key: string): string {
    const full = path.resolve(this.base, key)
    if (!full.startsWith(this.base + path.sep) && full !== this.base) {
      throw new Error("Invalid storage key")
    }
    return full
  }

  async put(tenantId: string, fileName: string, data: Buffer | Uint8Array) {
    const safe = fileName.replace(/[^\w.\-]+/g, "_").slice(0, 120) || "file"
    const key = `${tenantId}/${randomUUID()}-${safe}`
    const full = this.resolveSafe(key)
    await fs.mkdir(path.dirname(full), { recursive: true })
    const buf = Buffer.from(data)
    await fs.writeFile(full, buf)
    return { key, size: buf.byteLength }
  }

  async get(key: string) {
    return fs.readFile(this.resolveSafe(key))
  }

  async delete(key: string) {
    await fs.rm(this.resolveSafe(key), { force: true })
  }
}

// S3/MinIO driver (STORAGE_DRIVER=s3) is a future drop-in implementing the same
// interface; local volume is the lightweight default.
export const storage: StorageService = new LocalStorage()
