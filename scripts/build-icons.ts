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
// Window icon on Windows and Linux.
render('icon-square.svg', 256, `${res}/icon.png`)

// Installer icons; electron-builder turns these into .icns and .ico.
const build = 'packages/desktop/build'
render('icon-macos.svg', 1024, `${build}/icon.png`)
render('icon-square.svg', 1024, `${build}/icon-square.png`)
for (const size of [16, 32, 48, 64, 128, 256, 512])
  render('icon-square.svg', size, `${build}/icons/${size}x${size}.png`)

// iOS app icon: full-bleed square; iOS rounds the corners itself.
render('icon.svg', 1024, 'packages/ios-shell/assets/icon.png')
render(
  'icon.svg',
  1024,
  'packages/ios-shell/ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png',
)
// iOS launch screen, in the three slots Capacitor's template uses.
const splash = 'packages/ios-shell/ios/App/App/Assets.xcassets/Splash.imageset'
for (const name of ['splash-2732x2732.png', 'splash-2732x2732-1.png', 'splash-2732x2732-2.png'])
  render('splash.svg', 2732, `${splash}/${name}`)
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
