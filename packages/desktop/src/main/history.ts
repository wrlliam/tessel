// Chart history: every value a chart tile showed, so phones can scroll back through it.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'

export type Point = [time: number, value: number]

/** Points kept per tile at most, whatever the time limit, so memory stays bounded. */
export const MAX_POINTS = 50_000
/** Points at most in one answer to a phone. */
export const PAGE_POINTS = 1500

export class History {
  private series = new Map<string, Point[]>()
  private dirty = false
  private saveTimer?: NodeJS.Timeout

  constructor(
    private file: string,
    private keepMinutes: () => number,
    private now: () => number = Date.now,
  ) {}

  async load() {
    try {
      const raw = JSON.parse(await readFile(this.file, 'utf8')) as Record<string, unknown>
      for (const [id, points] of Object.entries(raw)) {
        if (!Array.isArray(points)) continue
        const ok = points.filter(
          (p): p is Point =>
            Array.isArray(p) && typeof p[0] === 'number' && typeof p[1] === 'number',
        )
        if (ok.length) this.series.set(id, ok)
      }
      this.prune()
    } catch {
      // No history yet, or a broken file: start empty.
    }
  }

  /** Adds a point, dropping the oldest ones past the time limit or the size cap. */
  record(tileId: string, value: number, at = this.now()): Point {
    const list = this.series.get(tileId) ?? []
    const point: Point = [at, value]
    list.push(point)
    this.series.set(tileId, list)
    this.trim(list)
    this.changed()
    return point
  }

  last(tileId: string): Point | undefined {
    return this.series.get(tileId)?.at(-1)
  }

  /** Up to `limit` points before `before` (or the newest), oldest first. */
  page(tileId: string, before = Infinity, limit = PAGE_POINTS): { points: Point[]; more: boolean } {
    const list = this.series.get(tileId) ?? []
    let end = list.length
    if (before !== Infinity) {
      // Binary search for the first point at or after `before`.
      let lo = 0
      let hi = list.length
      while (lo < hi) {
        const mid = (lo + hi) >> 1
        if ((list[mid] as Point)[0] < before) lo = mid + 1
        else hi = mid
      }
      end = lo
    }
    const start = Math.max(0, end - limit)
    return { points: list.slice(start, end), more: start > 0 }
  }

  /** Recent values only, for small previews. */
  recent(tileId: string, count: number): number[] {
    return (this.series.get(tileId) ?? []).slice(-count).map((p) => p[1])
  }

  /** Forgets tiles that no longer have a chart. */
  keepOnly(tileIds: Set<string>) {
    for (const id of this.series.keys())
      if (!tileIds.has(id)) {
        this.series.delete(id)
        this.changed()
      }
  }

  prune() {
    for (const [id, list] of this.series) {
      this.trim(list)
      if (!list.length) this.series.delete(id)
    }
    this.changed()
  }

  async flush() {
    clearTimeout(this.saveTimer)
    this.saveTimer = undefined
    if (!this.dirty) return
    this.dirty = false
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await writeFile(tmp, JSON.stringify(Object.fromEntries(this.series)))
    await rename(tmp, this.file)
  }

  dispose() {
    clearTimeout(this.saveTimer)
  }

  private trim(list: Point[]) {
    const oldest = this.now() - this.keepMinutes() * 60_000
    let drop = 0
    while (drop < list.length && (list[drop] as Point)[0] < oldest) drop++
    drop = Math.max(drop, list.length - MAX_POINTS)
    if (drop > 0) list.splice(0, drop)
  }

  private changed() {
    this.dirty = true
    // Written every half minute at most, so a busy chart doesn't wear the disk.
    this.saveTimer ??= setTimeout(() => void this.flush().catch(() => {}), 30_000)
  }
}
