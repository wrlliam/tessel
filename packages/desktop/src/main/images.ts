// Pictures for tiles: fetched or read, then shrunk to a small JPEG data: URL with Electron, so
// phones get a few KB and never fetch anything themselves.
import { nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

const MAX_SIDE = 192
const MAX_SOURCE_BYTES = 8 * 1024 * 1024

export async function loadTileImage(src: string): Promise<string | undefined> {
  let image: Electron.NativeImage
  if (src.startsWith('data:image/')) image = nativeImage.createFromDataURL(src)
  else {
    let bytes: Buffer
    if (src.startsWith('file://')) bytes = await readFile(fileURLToPath(src))
    else if (/^https?:\/\//i.test(src)) {
      const res = await fetch(src, { signal: AbortSignal.timeout(8000) })
      if (!res.ok) return undefined
      if (Number(res.headers.get('content-length') ?? 0) > MAX_SOURCE_BYTES) return undefined
      bytes = Buffer.from(await res.arrayBuffer())
    } else if (src.startsWith('/') || /^[a-z]:\\/i.test(src)) bytes = await readFile(src)
    else return undefined
    if (bytes.byteLength > MAX_SOURCE_BYTES) return undefined
    image = nativeImage.createFromBuffer(bytes)
  }
  if (image.isEmpty()) return undefined
  const { width, height } = image.getSize()
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const small =
    scale < 1
      ? image.resize({
          width: Math.round(width * scale),
          height: Math.round(height * scale),
          quality: 'good',
        })
      : image
  return `data:image/jpeg;base64,${small.toJPEG(82).toString('base64')}`
}
