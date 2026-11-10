import { Cron } from 'croner'
import { z } from 'zod'
import { defineBlock, flowOut } from '../block.ts'

export const onPress = defineBlock({
  id: 'trigger.press',
  category: 'trigger',
  name: 'On press',
  description: 'Starts when the tile is tapped.',
  trigger: 'press',
  inputs: [],
  outputs: [flowOut],
  paramsSchema: z.object({}),
  run: () => {},
})

const simpleTrigger = (
  id: string,
  name: string,
  description: string,
  trigger: 'longPress' | 'doubleTap' | 'release' | 'pageOpen',
) =>
  defineBlock({
    id,
    category: 'trigger',
    name,
    description,
    trigger,
    inputs: [],
    outputs: [flowOut],
    paramsSchema: z.object({}),
    fields: [],
    defaults: {},
    run: () => {},
  })

export const onLongPress = simpleTrigger(
  'trigger.longPress',
  'On long press',
  'Starts when the tile is held for half a second. On press then only fires for short taps.',
  'longPress',
)
export const onDoubleTap = simpleTrigger(
  'trigger.doubleTap',
  'On double tap',
  'Starts when the tile is tapped twice quickly. On press then waits a moment, to tell a single tap apart.',
  'doubleTap',
)
export const onRelease = simpleTrigger(
  'trigger.release',
  'On release',
  'Starts when you lift your finger.',
  'release',
)
export const onPageOpen = simpleTrigger(
  'trigger.pageOpen',
  'On page open',
  "Starts when a phone shows the page this tile is on. Good for refreshing a tile's status.",
  'pageOpen',
)

export const onSchedule = defineBlock({
  id: 'trigger.schedule',
  category: 'trigger',
  name: 'On schedule',
  description:
    'Starts at set times, written as a cron pattern, for the profile phones are using. By default only while a phone shows the tile’s page; set Run to Always for reminders and the like.',
  trigger: 'schedule',
  inputs: [],
  outputs: [flowOut],
  paramsSchema: z.object({
    cron: z.string().superRefine((s, ctx) => {
      const error = cronError(s)
      if (error) ctx.addIssue({ code: 'custom', message: error })
    }),
    when: z.enum(['pageOpen', 'always']).default('pageOpen'),
  }),
  fields: [
    {
      key: 'cron',
      label: 'When',
      widget: 'cron',
      placeholder: '0 9 * * 1-5',
      help: 'minute hour day month weekday. 0 9 * * 1-5 is 9:00 on weekdays.',
    },
    {
      key: 'when',
      label: 'Run',
      widget: 'select',
      options: [
        { value: 'pageOpen', label: 'Only while a phone shows this page' },
        { value: 'always', label: 'Always' },
      ],
      help: 'Live tiles only need to update while someone can see them.',
    },
  ],
  defaults: { cron: '0 9 * * 1-5', when: 'pageOpen' },
  run: () => {},
})

/** Why a cron pattern can't be used, or undefined if it's fine. */
export function cronError(pattern: string): string | undefined {
  try {
    new Cron(pattern, { paused: true }).stop()
    return undefined
  } catch (err) {
    return (err as Error).message.replace(/^CronPattern: /, '')
  }
}

/** The next times a valid pattern fires, in local time. */
export function nextRuns(pattern: string, count = 3, from?: Date): Date[] {
  const job = new Cron(pattern, { paused: true })
  try {
    return job.nextRuns(count, from)
  } finally {
    job.stop()
  }
}

const SlideParams = z
  .object({
    min: z.number().default(0),
    max: z.number().default(100),
    step: z.number().positive().default(1),
  })
  .refine((p) => p.max > p.min, { message: 'Highest must be more than lowest', path: ['max'] })

/** Maps a slider position (0 to 100) onto min..max, rounded to step. */
export function slideValue(position: number, p: { min: number; max: number; step: number }) {
  const raw = p.min + ((p.max - p.min) * Math.min(100, Math.max(0, position))) / 100
  const stepped = Math.round((raw - p.min) / p.step) * p.step + p.min
  return Math.min(p.max, Math.max(p.min, Number(stepped.toFixed(6))))
}

export const onSlide = defineBlock({
  id: 'trigger.slide',
  category: 'trigger',
  name: 'On slide',
  description:
    'Starts when a slider tile is dragged on the phone. value goes from Lowest to Highest, e.g. 0 to 100 for volume, and is kept in {{state.value}}.',
  trigger: 'slide',
  inputs: [],
  outputs: [flowOut, { id: 'value', kind: 'value', type: 'number', label: 'value' }],
  paramsSchema: SlideParams,
  fields: [
    { key: 'min', label: 'Lowest', widget: 'number' },
    { key: 'max', label: 'Highest', widget: 'number' },
    { key: 'step', label: 'Step', widget: 'number' },
  ],
  defaults: { min: 0, max: 100, step: 1 },
  run: (ctx, p) => {
    const position = Number(ctx.trigger.data?.['value'] ?? 0)
    const value = slideValue(Number.isFinite(position) ? position : 0, p)
    // Lets the tile show it, e.g. label {{state.value}}%.
    ctx.tileState.set('value', value)
    return { values: { value } }
  },
})

export const triggerBlocks = [
  onPress,
  onLongPress,
  onDoubleTap,
  onRelease,
  onSlide,
  onPageOpen,
  onSchedule,
]
