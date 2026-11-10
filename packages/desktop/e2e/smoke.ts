// End-to-end check of the editor against the built app, using a throwaway data folder.
// Run: pnpm --filter @tessel/desktop build && pnpm --filter @tessel/desktop e2e
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron, type Page } from 'playwright-core'

const appDir = join(import.meta.dirname, '..')
const shots = process.env['TESSEL_E2E_SHOTS']
const step = (name: string) => console.log(`- ${name}`)

async function center(page: Page, selector: string) {
  const box = await page.locator(selector).first().boundingBox()
  if (!box) throw new Error(`Not visible: ${selector}`)
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

const dataDir = await mkdtemp(join(tmpdir(), 'tessel-e2e-'))
await writeFile(
  join(dataDir, 'settings.json'),
  JSON.stringify({ schemaVersion: 1, data: { allowPhones: false, port: 4747 } }),
)

const app = await electron.launch({
  // CI runners on Linux can't use Chromium's setuid sandbox.
  args: process.env['CI'] && process.platform === 'linux' ? ['.', '--no-sandbox'] : ['.'],
  cwd: appDir,
  env: { ...process.env, TESSEL_DATA_DIR: dataDir },
})
const errors: string[] = []
try {
  const page = await app.firstWindow()
  page.on('pageerror', (e) => errors.push(e.message))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))

  step('first run shows the tour; Next moves on, Skip closes it for good')
  const tour = page.getByRole('dialog', { name: 'Your phone, as a deck of keys' })
  await tour.waitFor()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('dialog', { name: 'What will you use it for?' }).waitFor()
  await page.getByRole('button', { name: 'Music', pressed: false }).waitFor()
  await page.getByRole('button', { name: 'Next' }).click()
  await page.getByRole('dialog', { name: 'Connect your phone' }).waitFor()
  await page.getByRole('button', { name: 'Skip' }).click()
  await page.getByRole('dialog').waitFor({ state: 'detached' })

  step('editor opens on the first tile')
  await page.getByRole('button', { name: 'Test run' }).waitFor()

  step('add a tile in an empty slot; it starts with On press')
  await page.getByRole('button', { name: 'Add something in row 5, column 1' }).click()
  await page.getByRole('button', { name: 'Blank tile' }).click()
  await page.locator('.react-flow__node', { hasText: 'On press' }).waitFor()

  step('Space opens the block search; pick Delay')
  const pane = await center(page, '.react-flow__pane')
  await page.mouse.move(pane.x + 150, pane.y)
  await page.mouse.click(pane.x + 150, pane.y)
  await page.keyboard.press('Space')
  await page.getByPlaceholder('Add a block…').fill('delay')
  await page.keyboard.press('Enter')
  const delay = page.locator('.react-flow__node', { hasText: 'Delay' })
  await delay.waitFor()

  step('set the delay in the inspector')
  await page.getByLabel('Milliseconds').fill('40')

  step('wire On press to Delay by dragging between ports')
  const from = await center(
    page,
    '.react-flow__node:has-text("On press") .react-flow__handle-right',
  )
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(from.x + 20, from.y + 10, { steps: 5 })
  await page
    .locator('.react-flow__node:has-text("Delay") .react-flow__handle-left')
    .hover({ force: true })
  await page.mouse.up()
  await page.locator('.react-flow__edge').first().waitFor()

  step('Test run lights up the nodes and logs the run')
  await page.getByRole('button', { name: 'Test run' }).click()
  await page
    .getByText(/New tile.*ran in \d+ ms|ran in \d+ ms/)
    .first()
    .waitFor()
  await delay.getByText(/\d+ ms/).waitFor()
  if (shots) await page.screenshot({ path: join(shots, 'e2e-run.png') })

  step('the profile was saved with the new graph')
  const saved = JSON.parse(await readFile(join(dataDir, 'profiles', 'default.json'), 'utf8'))
  const tile = saved.data.pages[0].tiles.find((t: { label: string }) => t.label === 'New tile')
  if (!tile || tile.graph.nodes.length !== 2 || tile.graph.edges.length !== 1) {
    throw new Error(`Saved graph is wrong: ${JSON.stringify(tile?.graph)}`)
  }

  step('undo removes the wire')
  await page.mouse.click(pane.x - 200, pane.y + 150)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await page.locator('.react-flow__edge').waitFor({ state: 'detached' })

  step('redo brings it back')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
  await page.locator('.react-flow__edge').first().waitFor()

  step('wire from the inspector without a mouse drag')
  await page
    .getByRole('complementary', { name: 'Blocks' })
    .getByRole('button', { name: 'Open app' })
    .click()
  await delay.click()
  await page.getByLabel('Connect out to').selectOption({ label: 'Open app › in' })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 2)

  step('add a page and switch to it')
  await page.getByRole('button', { name: 'Page', exact: true }).click()
  await page.getByRole('button', { name: /^Blank page/ }).click()
  await page.getByText('Tiles on “Page 2”').waitFor()

  step('a ready-made page arrives filled')
  await page.getByRole('button', { name: 'Page', exact: true }).click()
  await page.getByRole('button', { name: /^Music/ }).click()
  await page.getByText('Tiles on “Music”').waitFor()
  await page.getByRole('button', { name: /Tile Volume/ }).waitFor()
  await page.getByRole('button', { name: /^Page 2$/ }).click()
  await page.getByText('Tiles on “Page 2”').waitFor()

  step('add a folder; its page gets a Back slot')
  await page.getByRole('button', { name: 'Add something in row 1, column 2' }).click()
  await page.getByRole('button', { name: 'Folder' }).click()
  await page.getByRole('button', { name: /Open “Folder”/ }).click()
  await page.getByLabel('Back tile, added by the phone').waitFor()

  step('insert a template into the folder')
  await page.getByRole('button', { name: 'Templates' }).click()
  await page.getByRole('button', { name: /^Counter Counts/ }).click()
  await page.getByRole('button', { name: 'Tile Count' }).waitFor()

  step('drag a tile to another slot')
  const tileBox = await page.getByRole('button', { name: 'Tile Count' }).boundingBox()
  if (!tileBox) throw new Error('No tile')
  await page.mouse.move(tileBox.x + 20, tileBox.y + 20)
  await page.mouse.down()
  await page.mouse.move(tileBox.x + 40, tileBox.y + 60, { steps: 4 })
  await page.mouse.move(tileBox.x + 20, tileBox.y + 20 + 72, { steps: 4 })
  await page.mouse.up()
  await page.waitForTimeout(800)
  const moved = await page.evaluate(async () => {
    const p = await window.tessel.getProfile('default')
    return p?.pages.flatMap((pg) => pg.tiles).find((x) => x.label === 'Count')?.position
  })
  if (moved?.col !== 1 || moved.row !== 1)
    throw new Error(`Tile landed at ${JSON.stringify(moved)}, expected col 1 row 1`)
  if (shots) await page.screenshot({ path: join(shots, 'e2e-folder.png') })

  step('Set setting shows only the fields for the chosen setting')
  await page.getByRole('tab', { name: 'Editor' }).click()
  await page.getByRole('button', { name: 'Page', exact: true }).click()
  await page.getByRole('button', { name: /^Blank page/ }).click()
  await page.getByRole('button', { name: 'Add something in row 1, column 1' }).click()
  await page.getByRole('button', { name: 'Blank tile' }).click()
  await page
    .getByRole('complementary', { name: 'Blocks' })
    .getByRole('button', { name: 'Set setting' })
    .click()
  await page.getByLabel('Turn').waitFor()
  await page.getByLabel('Setting', { exact: true }).selectOption('volume')
  await page.getByLabel('Level (0 to 100)').waitFor()
  if (await page.getByLabel('Turn').count()) throw new Error('On/off field should hide for volume')

  step('Settings: shell commands can be set to ask every time')
  await page.getByRole('tab', { name: 'Settings' }).click()
  await page.getByRole('radio', { name: 'Ask every time' }).click()
  await page.getByRole('radio', { name: 'Ask every time', checked: true }).waitFor()
  if (shots) await page.screenshot({ path: join(shots, 'e2e-settings.png') })

  step('built-in plugins run in their own processes')
  await page.getByRole('tab', { name: 'Plugins' }).click()
  const card = (name: string) => page.locator('li', { has: page.getByRole('heading', { name }) })
  await card('System info')
    .getByText(/Running · 2 blocks/)
    .waitFor({ timeout: 15000 })
  await card('Voicemeeter')
    .getByText(/Running · 10 blocks/)
    .waitFor({ timeout: 15000 })
  if (process.platform !== 'win32')
    await card('Voicemeeter')
      .getByText(/Made for Windows/)
      .waitFor()

  step('a plugin block runs; Voicemeeter answers plainly off Windows')
  const pluginRuns = await page.evaluate(async () => {
    const profile = await window.tessel.getProfile('default')
    if (!profile) throw new Error('no profile')
    const node = (id: string, type: string, params = {}) => ({
      id,
      type,
      params,
      position: { x: 0, y: 0 },
    })
    const wire = (from: string, to: string, port = 'in') => ({
      id: from + to,
      from: { nodeId: from, port: from === 'p' ? 'out' : 'out' },
      to: { nodeId: to, port },
    })
    const page0 = profile.pages[0]!
    page0.tiles = page0.tiles.filter((t) => t.position.row < 4)
    page0.tiles.push(
      {
        ...page0.tiles[0]!,
        id: 'sysinfo',
        label: 'CPU',
        position: { col: 0, row: 4 },
        span: { w: 1, h: 1 },
        kind: 'action',
        appearanceBindings: [],
        graph: {
          nodes: [
            node('p', 'trigger.press'),
            node('i', 'system.info'),
            node('v', 'data.setVariable', { name: 'cpu', value: '' }),
          ],
          edges: [
            wire('p', 'v'),
            { id: 'iv', from: { nodeId: 'i', port: 'cpu' }, to: { nodeId: 'v', port: 'value' } },
          ],
        },
      },
      {
        ...page0.tiles[0]!,
        id: 'vm',
        label: 'VM',
        position: { col: 1, row: 4 },
        span: { w: 1, h: 1 },
        kind: 'action',
        appearanceBindings: [],
        graph: {
          nodes: [
            node('p', 'trigger.press'),
            node('g', 'voicemeeter.setGain', { target: 'strip', index: 1, gain: 0 }),
          ],
          edges: [wire('p', 'g')],
        },
      },
    )
    const saved = await window.tessel.saveProfile(profile)
    if (!saved.ok) throw new Error(saved.error)
    await window.tessel.testRun('default', 'sysinfo')
    await window.tessel.testRun('default', 'vm')
    return (await window.tessel.getProfile('default'))?.variables['cpu']
  })
  if (typeof pluginRuns !== 'number')
    throw new Error(`System info gave ${JSON.stringify(pluginRuns)}`)
  await page.getByRole('tab', { name: 'Phones' }).click()
  if (process.platform !== 'win32')
    await page.getByText('"VM" › Set gain: Voicemeeter is Windows-only.').waitFor()
  step('My blocks: create the folder and run a block written in TypeScript')
  // Stands in for the permission prompt and keeps the folder from opening in Finder.
  await app.evaluate(({ dialog, shell }) => {
    dialog.showMessageBox = (async () => ({ response: 0, checkboxChecked: false })) as never
    shell.openPath = (async () => '') as never
  })
  await page.getByRole('tab', { name: 'Plugins' }).click()
  await page.getByRole('button', { name: 'Create my blocks folder' }).click()
  await page.getByText(/blocks, under Plugins › My blocks/).waitFor({ timeout: 30_000 })
  const custom = await page.evaluate(async () => {
    const profile = await window.tessel.getProfile('default')
    if (!profile) throw new Error('no profile')
    const at = { x: 0, y: 0 }
    const page0 = profile.pages[0]!
    page0.tiles = page0.tiles.filter((t) => t.position.row + t.span.h <= 3)
    page0.tiles.push({
      id: 'lunch',
      label: 'Lunch',
      colour: '#212833',
      position: { col: 0, row: 3 },
      span: { w: 1, h: 1 },
      kind: 'action',
      concurrency: 'queue',
      appearanceBindings: [],
      graph: {
        nodes: [
          { id: 'p', type: 'trigger.press', params: {}, position: at },
          { id: 'b', type: 'my-blocks.pick-one', params: { choices: 'Soup\nRamen' }, position: at },
          { id: 's', type: 'data.setVariable', params: { name: 'lunch' }, position: at },
          {
            id: 't',
            type: 'action.toast',
            params: { title: 'Lunch', body: 'Soup or ramen', seconds: 2, position: 'top-right' },
            position: at,
          },
        ],
        edges: [
          { id: 'e1', from: { nodeId: 'p', port: 'out' }, to: { nodeId: 'b', port: 'in' } },
          { id: 'e2', from: { nodeId: 'b', port: 'out' }, to: { nodeId: 's', port: 'in' } },
          { id: 'e3', from: { nodeId: 'b', port: 'choice' }, to: { nodeId: 's', port: 'value' } },
          { id: 'e4', from: { nodeId: 's', port: 'out' }, to: { nodeId: 't', port: 'in' } },
        ],
      },
    })
    const saved = await window.tessel.saveProfile(profile)
    if (!saved.ok) throw new Error(saved.error)
    await window.tessel.testRun('default', 'lunch')
    return (await window.tessel.getProfile('default'))?.variables['lunch']
  })
  if (custom !== 'Soup' && custom !== 'Ramen')
    throw new Error(`My blocks gave ${JSON.stringify(custom)}`)

  step('Try mode presses a tile from the editor, like the phone')
  await page.evaluate(() => window.tessel.addVariables('default', { lunch: 'none' }))
  // The tile was saved straight to the main process above; reload so the editor has it.
  await page.reload()
  await page.getByRole('button', { name: 'Try', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Try', exact: true }).click()
  await page.getByRole('button', { name: /^Tile Lunch/ }).click()
  await page.waitForFunction(async () => {
    const v = (await window.tessel.getProfile('default'))?.variables['lunch']
    return v === 'Soup' || v === 'Ramen'
  })
  await page.getByRole('button', { name: 'Try', exact: true }).click()

  step('share the tile as a .tel and open it again, code and all')
  const telPath = join(dataDir, 'lunch.tel')
  await app.evaluate(({ dialog }, path) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as never
  }, telPath)
  const shared = await page.evaluate(async (path) => {
    const profile = await window.tessel.getProfile('default')
    const tile = profile?.pages[0]?.tiles.find((t) => t.id === 'lunch')
    if (!profile || !tile) throw new Error('no lunch tile')
    const out = await window.tessel.exportTel({
      profileId: 'default',
      name: 'Lunch',
      tiles: [tile],
    })
    if (!out.ok) throw new Error(JSON.stringify(out))
    const back = await window.tessel.importTel(path)
    return back.ok ? back.tiles.map((t) => t.graph.nodes.map((n) => n.type).join(',')) : back
  }, telPath)
  if (!Array.isArray(shared) || !String(shared[0]).includes('my-blocks.pick-one'))
    throw new Error(`.tel round trip gave ${JSON.stringify(shared)}`)

  step('the pop-up shows above other windows')
  const toastShown = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some(
      (w) =>
        w.isVisible() && w.isAlwaysOnTop() && w.webContents.getURL().startsWith('data:text/html'),
    ),
  )
  if (!toastShown) throw new Error('The pop-up window did not show')

  if (shots) {
    await page.getByRole('tab', { name: 'Plugins' }).click()
    await page.screenshot({ path: join(shots, 'e2e-plugins.png') })
  }

  if (errors.length) throw new Error(`Renderer errors:\n${errors.join('\n')}`)
  console.log('Smoke test passed')
} catch (err) {
  if (errors.length) console.error(`Renderer errors:\n${errors.join('\n')}`)
  if (shots) await (await app.firstWindow()).screenshot({ path: join(shots, 'e2e-failure.png') })
  throw err
} finally {
  await app.close()
}
