import { defineBlock, definePlugin, PluginError } from '@tessel/plugin-sdk'
import { z } from 'zod'

export type Fetch = (url: string, init?: RequestInit) => Promise<Response>
const flowIn = { id: 'in', kind: 'flow' as const }
const flowOut = { id: 'out', kind: 'flow' as const }

export function createSlackPlugin(fetchFn: Fetch) {
  let token = ''
  const apply = (s: Record<string, unknown>) => void (token = String(s['token'] ?? '').trim())
  async function slack(method: string, body: Record<string, unknown>) {
    if (!token)
      throw new PluginError('Add a Slack user token in Plugins › Slack status › Settings.')
    let res: Response
    try {
      res = await fetchFn(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(body),
      })
    } catch {
      throw new PluginError("Can't reach Slack. Check the internet connection.")
    }
    const data = (await res.json()) as { ok: boolean; error?: string }
    if (!data.ok) {
      const reason = data.error ?? 'unknown_error'
      throw new PluginError(
        reason === 'invalid_auth' || reason === 'not_authed'
          ? 'Slack refused the token. Check it in the plugin settings.'
          : reason === 'missing_scope'
            ? 'The token needs the users.profile:write and dnd:write scopes.'
            : `Slack said: ${reason}`,
      )
    }
    return data
  }

  return definePlugin({
    onLoad: (ctx) => apply(ctx.settings),
    onSettings: apply,
    blocks: [
      defineBlock({
        id: 'status',
        name: 'Slack: set status',
        description:
          'Sets your status text and emoji, optionally clearing itself after some minutes. Empty text clears it.',
        inputs: [flowIn, { id: 'text', kind: 'value', type: 'string' }],
        outputs: [flowOut],
        paramsSchema: z.object({
          text: z.string().max(100).default(''),
          emoji: z.string().max(60).default(''),
          minutes: z.coerce.number().int().min(0).max(10080).default(0),
        }),
        fields: [
          { key: 'text', label: 'Status', widget: 'text', placeholder: 'In a meeting' },
          { key: 'emoji', label: 'Emoji', widget: 'text', placeholder: ':calendar:' },
          {
            key: 'minutes',
            label: 'Clear after (minutes)',
            widget: 'number',
            placeholder: '0 keeps it',
          },
        ],
        defaults: { text: '', emoji: '', minutes: 0 },
        run: async (_ctx, p, input) => {
          const text = typeof input['text'] === 'string' && input['text'] ? input['text'] : p.text
          const emoji =
            p.emoji && !p.emoji.startsWith(':') ? `:${p.emoji.replace(/:/g, '')}:` : p.emoji
          await slack('users.profile.set', {
            profile: {
              status_text: text,
              status_emoji: text ? emoji : '',
              status_expiration:
                text && p.minutes ? Math.floor(Date.now() / 1000) + p.minutes * 60 : 0,
            },
          })
        },
      }),
      defineBlock({
        id: 'dnd',
        name: 'Slack: pause notifications',
        description: 'Pauses Slack notifications for some minutes, or turns pausing off.',
        inputs: [flowIn],
        outputs: [flowOut],
        paramsSchema: z.object({
          action: z.enum(['pause', 'resume']).default('pause'),
          minutes: z.coerce.number().int().min(1).max(1440).default(60),
        }),
        fields: [
          {
            key: 'action',
            label: 'Action',
            widget: 'select',
            options: [
              { value: 'pause', label: 'Pause' },
              { value: 'resume', label: 'Resume' },
            ],
          },
          {
            key: 'minutes',
            label: 'Minutes',
            widget: 'number',
            when: { key: 'action', is: ['pause'] },
          },
        ],
        defaults: { action: 'pause', minutes: 60 },
        run: async (ctx, p) => {
          if (p.action === 'pause') await slack('dnd.setSnooze', { num_minutes: p.minutes })
          else await slack('dnd.endSnooze', {})
          ctx.setTileState('paused', p.action === 'pause')
        },
      }),
    ],
  })
}
