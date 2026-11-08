/**
 * Ranks a block for the Add block search. Plain matching beats fuzzy here: typing "delay"
 * must put Delay first, not a block whose description happens to contain d-e-l-a-y.
 */
export function blockScore(name: string, description: string, query: string): number {
  const q = query.trim().toLowerCase()
  if (!q) return 1
  const n = name.toLowerCase()
  if (n === q) return 1
  if (n.startsWith(q)) return 0.9
  if (n.split(/\s+/).some((word) => word.startsWith(q))) return 0.8
  if (n.includes(q)) return 0.6
  if (
    description
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .some((word) => word.startsWith(q))
  )
    return 0.3
  return 0
}
