import { pageTemplates, type Page } from '@tessel/core'
import {
  ChevronDown,
  ChevronUp,
  File,
  FileInput,
  Folder,
  LayoutGrid,
  Plus,
  Search,
  Share,
} from 'lucide-react'
import { useState } from 'react'
import { cn } from '../lib/cn.ts'
import { Button } from '../ui/button.tsx'
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover.tsx'
import { Field } from '../ui/field.tsx'
import { Input, Select } from '../ui/input.tsx'
import { parentOf } from './layout.ts'
import { openTel, shareTiles } from './share.ts'
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
        <NewPageMenu onPick={addPage} />
      </div>
      <ul className="space-y-0.5">{pages.map((p) => row(p, 0))}</ul>
    </section>
  )
}

/** Name, size, order and sharing for the selected page. Folded away until needed. */
export function PageSettings() {
  const page = useSelectedPage()
  const profile = useEditor((s) => s.profile)
  const { updatePage, movePage, deletePage } = useEditor.getState()
  const [confirm, setConfirm] = useState<string>()
  const [open, setOpen] = useState(false)
  if (!page || !profile) return null
  const order = profile.pages.filter((p) => p.kind === 'page')
  const index = order.findIndex((p) => p.id === page.id)
  const parent = page.kind === 'folder' ? parentOf(profile, page.id) : undefined

  const what = page.kind === 'folder' ? 'Folder' : 'Page'
  return (
    <section aria-label={`${what} settings`} className="rounded-xl border border-line">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex h-10 w-full items-center gap-2 rounded-xl px-3 text-left text-sm transition-colors hover:bg-line/60"
      >
        <span className="flex-1">{what} settings</span>
        <span className="font-mono text-xs text-muted tabular-nums">
          {page.cols} × {page.rows}
        </span>
        <ChevronDown
          className={cn('size-4 text-muted transition-transform', open && 'rotate-180')}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-line p-3">
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
            {page.kind === 'page' && page.tiles.length > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => void shareTiles(page.name, page.tiles, page)}
              >
                <Share /> Share
              </Button>
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
      )}
    </section>
  )
}

/** Blank page or a ready-made one. */
function NewPageMenu({ onPick }: { onPick: (template?: (typeof pageTemplates)[number]) => void }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const pick = (t?: (typeof pageTemplates)[number]) => {
    onPick(t)
    setOpen(false)
  }
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = pageTemplates.filter((t) => {
    const text = `${t.name} ${t.description}`.toLowerCase()
    return words.every((w) => text.includes(w))
  })
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o)
        if (o) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost">
          <Plus /> Page
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        collisionPadding={12}
        className="flex max-h-[var(--radix-popover-content-available-height)] w-80 flex-col p-1"
        aria-label="New page"
      >
        <button
          type="button"
          onClick={() => pick()}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-line"
        >
          <File className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>
            Blank page
            <span className="block text-xs text-muted">Same size as the page you're on</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => {
            setOpen(false)
            void openTel()
          }}
          className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-line"
        >
          <FileInput className="mt-0.5 size-4 shrink-0 text-muted" />
          <span>
            From a .tel file…
            <span className="block text-xs text-muted">Tiles or a page someone shared</span>
          </span>
        </button>
        <div className="mx-1 mt-2 mb-1 flex h-8 shrink-0 items-center gap-2 rounded-md px-2 shadow-[inset_0_0_0_1px_var(--line)] focus-within:shadow-[inset_0_0_0_1px_var(--glaze)]">
          <Search className="size-4 shrink-0 text-muted" />
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && matches[0]) pick(matches[0])
            }}
            placeholder="Search ready-made pages"
            aria-label="Search ready-made pages"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted"
          />
          <span className="font-mono text-xs text-muted tabular-nums">{matches.length}</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {matches.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => pick(t)}
              className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-line focus-visible:bg-line focus-visible:outline-none"
            >
              <LayoutGrid className="mt-0.5 size-4 shrink-0 text-muted" />
              <span>
                {t.name}
                <span className="block text-xs text-muted">{t.description}</span>
              </span>
            </button>
          ))}
          {matches.length === 0 && (
            <p className="px-2 py-3 text-sm text-muted">No page matches “{query}”</p>
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
