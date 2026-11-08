// Renders the SVG masters in packages/brand to the PNGs each package needs.
import { Resvg } from '@resvg/resvg-js'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const root = join(import.meta.dirname, '..')

function render(svgFile: string, size: number, out: string, colour?: string) {
  let svg = readFileSync(join(root, 'packages/brand', svgFile), 'utf8')
  if (colour) svg = svg.replaceAll('#000', colour)
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()
  const target = join(root, out)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, png)
  console.log(`${out} (${size}px)`)
}

const phone = 'packages/phone/public'
render('icon.svg', 180, `${phone}/apple-touch-icon.png`)
render('icon.svg', 192, `${phone}/icon-192.png`)
render('icon.svg', 512, `${phone}/icon-512.png`)
render('logo-mark.svg', 64, `${phone}/favicon.png`)

const res = 'packages/desktop/resources'
render('icon-macos.svg', 1024, `${res}/icon.png`)
// macOS template images: black + alpha, the OS recolours them for light/dark menu bars.
for (const [name, file] of [
  ['trayTemplate', 'tray.svg'],
  ['trayConnectedTemplate', 'tray-connected.svg'],
] as const) {
  render(file, 16, `${res}/${name}.png`)
  render(file, 32, `${res}/${name}@2x.png`)
}
// Windows and Linux trays get a light glyph for dark taskbars.
render('tray.svg', 32, `${res}/tray-light.png`, '#F4F6F8')
render('tray-connected.svg', 32, `${res}/tray-connected-light.png`, '#F4F6F8')
