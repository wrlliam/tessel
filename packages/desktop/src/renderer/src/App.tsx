import logoUrl from '@tessel/brand/logo-mark.svg'
import { pageTemplates, type OS } from '@tessel/core'
import { Tabs } from 'radix-ui'
import { useCallback, useEffect, useState } from 'react'
import type { DesktopState } from '../../shared/api.ts'
import { ApprovePhone } from './ApprovePhone.tsx'
import { Editor } from './editor/Editor.tsx'
import { useEditor } from './editor/store.ts'
import { cn } from './lib/cn.ts'
import { PhonesView } from './PhonesView.tsx'
import { PluginsView } from './PluginsView.tsx'
import { SettingsView } from './SettingsView.tsx'
import { Switch } from './Switch.tsx'
import { Tour, type TabName } from './Tour.tsx'
import { useDesktopState } from './useDesktopState.ts'

const tabClass =
  'rounded-lg px-3 py-1 text-sm text-muted hover:text-text data-[state=active]:bg-line data-[state=active]:text-text'

export function App() {
  const state = useDesktopState()
  const [tab, setTab] = useState<TabName>('editor')
  const [touring, setTouring] = useState(true)
  const showTab = useCallback((t: TabName) => setTab(t), [])
  const theme = state?.settings.theme
  useEffect(() => {
    const root = document.documentElement
    if (!theme || theme === 'system') delete root.dataset['theme']
    else root.dataset['theme'] = theme
  }, [theme])
  if (!state) return null

  return (
    <Tabs.Root
      value={tab}
      onValueChange={(v) => setTab(v as TabName)}
      className="flex h-full flex-col"
    >
      {!state.toured && touring && (
        <Tour
          onTab={showTab}
          onStarter={(ids) => {
            const { addPage, selectPage } = useEditor.getState()
            const first = useEditor.getState().selectedPageId
            for (const id of ids) {
              const t = pageTemplates.find((p) => p.id === id)
              if (t) addPage(t)
            }
            if (first) selectPage(first)
          }}
          onDone={() => {
            setTouring(false)
            setTab('editor')
            void window.tessel.finishTour()
          }}
        />
      )}
      <ApprovePhone state={state} />
      <header
        className={cn(
          'drag flex items-center gap-4 border-b border-line px-4 py-2.5',
          state.platform === 'darwin' && 'pl-22',
        )}
      >
        <img src={logoUrl} alt="" className="size-6" />
        <h1 className="font-display text-lg font-semibold tracking-tight">Tessel</h1>
        <Tabs.List aria-label="Sections" className="ml-4 flex gap-1">
          <Tabs.Trigger value="editor" className={tabClass}>
            Editor
          </Tabs.Trigger>
          <Tabs.Trigger value="phones" className={tabClass}>
            Phones
          </Tabs.Trigger>
          <Tabs.Trigger value="plugins" className={tabClass}>
            Plugins
          </Tabs.Trigger>
          <Tabs.Trigger value="settings" className={tabClass}>
            Settings
          </Tabs.Trigger>
        </Tabs.List>
        <div className="ml-auto flex items-center gap-6">
          <StatusDot state={state} />
          <Switch
            label="Pause tiles"
            checked={state.paused}
            onChange={(on) => void window.tessel.setPaused(on)}
          />
          <Switch
            label="Allow phones"
            checked={state.allowPhones}
            onChange={(on) => void window.tessel.setAllowPhones(on)}
          />
        </div>
      </header>
      <Tabs.Content
        value="editor"
        className="flex min-h-0 flex-1 flex-col data-[state=inactive]:hidden"
        forceMount
      >
        <Editor
          os={state.platform as OS}
          profiles={state.profiles}
          activeProfileId={state.activeProfileId}
          liveAppearance={state.liveAppearance}
          liveSeries={state.liveSeries}
          theme={state.settings.theme}
          blocksVersion={state.blocksVersion}
          keyStyle={state.phoneSettings.keyStyle}
        />
      </Tabs.Content>
      <Tabs.Content value="phones" className="flex min-h-0 flex-1 flex-col">
        <PhonesView state={state} />
      </Tabs.Content>
      <Tabs.Content value="plugins" className="flex min-h-0 flex-1 flex-col">
        <PluginsView state={state} />
      </Tabs.Content>
      <Tabs.Content value="settings" className="flex min-h-0 flex-1 flex-col">
        <SettingsView state={state} />
      </Tabs.Content>
    </Tabs.Root>
  )
}

function StatusDot({ state }: { state: DesktopState }) {
  const online = state.devices.filter((d) => d.online).length
  const [dot, text] = state.serverError
    ? ['bg-signal', 'Not sharing']
    : !state.listening
      ? ['bg-muted', 'Phones off']
      : online > 0
        ? ['bg-glaze', online === 1 ? '1 phone' : `${online} phones`]
        : ['bg-cat-trigger', 'No phone yet']
  return (
    <span role="status" className="flex items-center gap-2 text-sm text-muted">
      <span className={`size-2 rounded-full ${dot}`} aria-hidden />
      {text}
    </span>
  )
}
