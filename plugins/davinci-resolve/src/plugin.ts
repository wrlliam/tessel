import { defineBlock, definePlugin, PluginError, type OS } from '@tessel/plugin-sdk'
import { z } from 'zod'

/** Runs Python with a script and extra environment; resolves to what it printed. */
export type RunPython = (
  python: string,
  script: string,
  env: Record<string, string>,
) => Promise<string>

const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

/** Where Resolve keeps its scripting module and library, per Blackmagic's README. */
export function scriptingEnv(os: OS, programData = 'C:\\ProgramData'): Record<string, string> {
  if (os === 'darwin') {
    const api = '/Library/Application Support/Blackmagic Design/DaVinci Resolve/Developer/Scripting'
    return {
      RESOLVE_SCRIPT_API: api,
      RESOLVE_SCRIPT_LIB:
        '/Applications/DaVinci Resolve/DaVinci Resolve.app/Contents/Libraries/Fusion/fusionscript.so',
      PYTHONPATH: `${api}/Modules/`,
    }
  }
  if (os === 'win32') {
    const api = `${programData}\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting`
    return {
      RESOLVE_SCRIPT_API: api,
      RESOLVE_SCRIPT_LIB: 'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fusionscript.dll',
      PYTHONPATH: `${api}\\Modules\\`,
    }
  }
  return {
    RESOLVE_SCRIPT_API: '/opt/resolve/Developer/Scripting',
    RESOLVE_SCRIPT_LIB: '/opt/resolve/libs/Fusion/fusionscript.so',
    PYTHONPATH: '/opt/resolve/Developer/Scripting/Modules/',
  }
}

/** Wraps an action in the connect-and-report boilerplate; the action sets `out`. */
export function wrap(action: string, args: Record<string, unknown> = {}): string {
  return `
import json, sys
args = json.loads(${JSON.stringify(JSON.stringify(args))})
def done(**kw):
    print(json.dumps(kw)); sys.exit(0)
try:
    import DaVinciResolveScript as dvr
except Exception as e:
    done(error="nomodule", detail=str(e))
resolve = dvr.scriptapp("Resolve")
if resolve is None:
    done(error="noresolve")
pm = resolve.GetProjectManager()
project = pm.GetCurrentProject()
timeline = project.GetCurrentTimeline() if project else None
out = {}
${action.trim()}
done(**out)
`
}

export const ACTIONS = {
  page: `
if not resolve.OpenPage(args["page"]):
    done(error="failed", detail="Resolve didn't switch to that page")`,
  marker: `
if not timeline:
    done(error="notimeline")
fps = float(timeline.GetSetting("timelineFrameRate"))
def frames(tc):
    h, m, s, f = [int(x) for x in tc.replace(";", ":").split(":")]
    return int(round(((h * 60 + m) * 60 + s) * fps)) + f
offset = frames(timeline.GetCurrentTimecode()) - frames(timeline.GetStartTimecode())
if not timeline.AddMarker(offset, args["color"], args["name"], args["note"], 1):
    done(error="failed", detail="There's already a marker at the playhead")
out["timecode"] = timeline.GetCurrentTimecode()`,
  render: `
if not project:
    done(error="noproject")
if args["preset"] and not project.LoadRenderPreset(args["preset"]):
    done(error="failed", detail="No render preset called " + args["preset"])
job = project.AddRenderJob()
if not job:
    done(error="failed", detail="Resolve couldn't add a render job; check the Deliver page settings")
if args["start"]:
    project.StartRendering(job)
out["job"] = job`,
  save: `
if not pm.SaveProject():
    done(error="failed", detail="Resolve didn't save the project")`,
  info: `
out["page"] = resolve.GetCurrentPage() or ""
out["project"] = project.GetName() if project else ""
out["timeline"] = timeline.GetName() if timeline else ""
out["timecode"] = timeline.GetCurrentTimecode() if timeline else ""
out["rendering"] = bool(project.IsRenderingInProgress()) if project else False`,
} as const

const ERRORS: Record<string, string> = {
  nomodule:
    "Can't load Resolve's scripting module. Install DaVinci Resolve (Studio) and Python 3, then try again.",
  noresolve:
    'Resolve isn’t answering. Open it, and in Preferences › System › General set External scripting using to Local.',
  noproject: 'Open a project in Resolve first.',
  notimeline: 'Open a timeline in Resolve first.',
}

export function createResolvePlugin(run: RunPython, os: () => OS) {
  let python = ''
  const apply = (s: Record<string, unknown>) => void (python = String(s['python'] ?? '').trim())

  async function call(action: keyof typeof ACTIONS, args: Record<string, unknown> = {}) {
    const exe = python || (os() === 'win32' ? 'python' : 'python3')
    let text: string
    try {
      text = await run(exe, wrap(ACTIONS[action], args), scriptingEnv(os()))
    } catch (err) {
      const m = (err as Error).message
      throw new PluginError(
        /ENOENT|not found|not recognized/i.test(m)
          ? `Can't find ${exe}. Install Python 3, or set its path in Plugins › DaVinci Resolve › Settings.`
          : `Resolve script failed: ${m.split('\n').slice(-1)[0]}`,
      )
    }
    const line = text.trim().split('\n').at(-1) ?? '{}'
    let result: Record<string, unknown>
    try {
      result = JSON.parse(line) as Record<string, unknown>
    } catch {
      throw new PluginError(`Resolve said something unexpected: ${line.slice(0, 120)}`)
    }
    if (result['error']) {
      const code = String(result['error'])
      throw new PluginError(ERRORS[code] ?? String(result['detail'] ?? 'Resolve refused'))
    }
    return result
  }

  const pageOptions = ['media', 'cut', 'edit', 'fusion', 'color', 'fairlight', 'deliver'] as const

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'page',
        name: 'Resolve: open a page',
        description:
          'Switches Resolve to the Media, Cut, Edit, Fusion, Color, Fairlight or Deliver page.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({ page: z.enum(pageOptions).default('edit') }),
        fields: [
          {
            key: 'page',
            label: 'Page',
            widget: 'select',
            options: pageOptions.map((p) => ({
              value: p,
              label: p[0]?.toUpperCase() + p.slice(1),
            })),
          },
        ],
        defaults: { page: 'edit' },
        run: async (_ctx, p) => {
          await call('page', { page: p.page })
        },
      }),
      defineBlock({
        id: 'marker',
        name: 'Resolve: add a marker',
        description: 'Adds a coloured, named marker at the playhead on the current timeline.',
        inputs: [flowIn, { id: 'name', kind: 'value', type: 'string' }],
        outputs: [flowOut, { id: 'timecode', kind: 'value', type: 'string' }],
        paramsSchema: z.object({
          color: z
            .enum([
              'Blue',
              'Cyan',
              'Green',
              'Yellow',
              'Red',
              'Pink',
              'Purple',
              'Fuchsia',
              'Rose',
              'Lavender',
              'Sky',
              'Mint',
              'Lemon',
              'Sand',
              'Cocoa',
              'Cream',
            ])
            .default('Blue'),
          name: z.string().max(100).default(''),
          note: z.string().max(500).default(''),
        }),
        fields: [
          {
            key: 'color',
            label: 'Colour',
            widget: 'select',
            options: [
              'Blue',
              'Cyan',
              'Green',
              'Yellow',
              'Red',
              'Pink',
              'Purple',
              'Rose',
              'Sky',
              'Mint',
            ].map((c) => ({ value: c, label: c })),
          },
          { key: 'name', label: 'Name', widget: 'text', placeholder: 'Fix audio' },
          { key: 'note', label: 'Note', widget: 'textarea' },
        ],
        defaults: { color: 'Blue', name: '', note: '' },
        run: async (_ctx, p, input) => {
          const name = typeof input['name'] === 'string' && input['name'] ? input['name'] : p.name
          const r = await call('marker', { color: p.color, name, note: p.note })
          return { values: { timecode: String(r['timecode'] ?? '') } }
        },
      }),
      defineBlock({
        id: 'render',
        name: 'Resolve: render',
        description:
          'Adds the timeline to the render queue with the Deliver page settings (or a saved preset), and starts rendering.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({
          preset: z.string().max(100).default(''),
          start: z.boolean().default(true),
        }),
        fields: [
          {
            key: 'preset',
            label: 'Render preset',
            widget: 'text',
            placeholder: 'Deliver page settings',
          },
          { key: 'start', label: 'Start rendering now', widget: 'toggle' },
        ],
        defaults: { preset: '', start: true },
        timeoutSeconds: 60,
        run: async (ctx, p) => {
          await call('render', { preset: p.preset, start: p.start })
          ctx.setTileState('rendering', p.start)
        },
      }),
      defineBlock({
        id: 'save',
        name: 'Resolve: save project',
        description: 'Saves the current project.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async () => {
          await call('save')
        },
      }),
      defineBlock({
        id: 'info',
        name: 'Resolve: what’s open',
        description:
          'The open project, timeline, playhead timecode and page, and whether it is rendering. Kept in tile state too, e.g. {{state.timecode}}.',
        inputs: [flowIn],
        outputs: [
          flowOut,
          { id: 'project', kind: 'value', type: 'string' },
          { id: 'timeline', kind: 'value', type: 'string' },
          { id: 'timecode', kind: 'value', type: 'string' },
          { id: 'page', kind: 'value', type: 'string' },
          { id: 'rendering', kind: 'value', type: 'boolean' },
        ],
        paramsSchema: z.object({}),
        fields: [],
        defaults: {},
        run: async (ctx) => {
          const r = await call('info')
          const values = {
            project: String(r['project'] ?? ''),
            timeline: String(r['timeline'] ?? ''),
            timecode: String(r['timecode'] ?? ''),
            page: String(r['page'] ?? ''),
            rendering: r['rendering'] === true,
          }
          for (const [k, v] of Object.entries(values)) ctx.setTileState(k, v)
          return { values }
        },
      }),
    ],
  })
}
