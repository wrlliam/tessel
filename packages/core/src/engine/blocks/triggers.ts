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
  trigger: 'longPress' | 'release' | 'pageOpen',
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
    'Starts at set times, written as a cron pattern. Runs for the profile phones are using.',
  trigger: 'schedule',
  inputs: [],
  outputs: [flowOut],
  paramsSchema: z.object({
    cron: z.string().superRefine((s, ctx) => {
      const error = cronError(s)
      if (error) ctx.addIssue({ code: 'custom', message: error })
    }),
  }),
  fields: [
    {
      key: 'cron',
      label: 'When',
      widget: 'cron',
      placeholder: '0 9 * * 1-5',
      help: 'minute hour day month weekday. 0 9 * * 1-5 is 9:00 on weekdays.',
    },
  ],
  defaults: { cron: '0 9 * * 1-5' },
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

export const triggerBlocks = [onPress, onLongPress, onRelease, onPageOpen, onSchedule]
