import type { Page } from '@tessel/core'
import { ChevronDown, ChevronUp, Folder, Plus } from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { Field } from '../ui/field.tsx'
import { Input, Select } from '../ui/input.tsx'
import { parentOf } from './layout.ts'
import { useEditor, useSelectedPage } from './store.ts'

const SIZES = [1, 2, 3, 4, 5, 6, 7, 8]

export function PagesPanel() {
  const profile = useEditor((s) => s.profile)
  const selected = useEditor((s) => s.selectedPageId)
  const { selectPage, addPage } = useEditor.getState()
  if (!profile) return null
  const pages = profile.pages.filter((p) => p.kind === 'page')
  const foldersOf = (pageId: string) =>
    profile.pages.filter((p) => p.kind === 'folder' && parentOf(profile, p.id)?.id === pageId)

  const row = (page: Page, depth: number): React.ReactNode => (
    <li key={page.id}>
      <button
        type="button"
        aria-current={page.id === selected || undefined}
        onClick={() => selectPage(page.id)}
        className={cn(
          'flex w-full items-center gap-1.5 rounded-lg px-2 py-1 text-left text-sm hover:bg-line/60',
          page.id === selected && 'bg-line text-text',
        )}
        style={{ paddingLeft: 8 + depth * 14 }}
      >
        {page.kind === 'folder' && <Folder className="size-3.5 text-muted" aria-label="Folder" />}
        <span className="truncate">{page.name}</span>
      </button>
      {foldersOf(page.id).length > 0 && <ul>{foldersOf(page.id).map((f) => row(f, depth + 1))}</ul>}
    </li>
  )

  return (
    <section aria-label="Pages" className="space-y-2">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-muted">Pages</h3>
        <Button size="sm" variant="ghost" onClick={addPage}>
          <Plus /> Page
        </Button>
      </div>
      <ul className="space-y-0.5">{pages.map((p) => row(p, 0))}</ul>
      <PageSettings />
    </section>
  )
}

function PageSettings() {
  const page = useSelectedPage()
  const profile = useEditor((s) => s.profile)
  const { updatePage, movePage, deletePage } = useEditor.getState()
  const [confirm, setConfirm] = useState<string>()
  if (!page || !profile) return null
  const order = profile.pages.filter((p) => p.kind === 'page')
  const index = order.findIndex((p) => p.id === page.id)
  const parent = page.kind === 'folder' ? parentOf(profile, page.id) : undefined

  return (
    <div className="space-y-3 rounded-xl border border-line p-3">
      <Field label={page.kind === 'folder' ? 'Folder name' : 'Page name'} htmlFor="page-name">
        <Input
          id="page-name"
          value={page.name}
          maxLength={40}
          onChange={(e) => updatePage(page.id, { name: e.target.value }, 'name')}
        />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Columns" htmlFor="page-cols">
          <Select
            id="page-cols"
            value={page.cols}
            onChange={(e) => updatePage(page.id, { cols: Number(e.target.value) })}
          >
            {SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
        <Field label="Rows" htmlFor="page-rows">
          <Select
            id="page-rows"
            value={page.rows}
            onChange={(e) => updatePage(page.id, { rows: Number(e.target.value) })}
          >
            {SIZES.map((n) => (
              <option key={n}>{n}</option>
            ))}
          </Select>
        </Field>
      </div>
      {parent && (
        <p className="text-xs text-muted">
          Opens from a folder tile on “{parent.name}”. The top-left slot is the Back tile.
        </p>
      )}
      <div className="flex flex-wrap gap-1">
        {page.kind === 'page' && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={index <= 0}
              onClick={() => movePage(page.id, -1)}
              aria-label="Move page earlier"
            >
              <ChevronUp /> Earlier
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={index >= order.length - 1}
              onClick={() => movePage(page.id, 1)}
              aria-label="Move page later"
            >
              <ChevronDown /> Later
            </Button>
          </>
        )}
        {confirm === page.id ? (
          <Button size="sm" variant="danger" onClick={() => deletePage(page.id)}>
            Delete with its tiles
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setConfirm(page.id)}>
            Delete
          </Button>
        )}
      </div>
    </div>
  )
}
