import { Copy, Download, Ellipsis, FilePlus, Trash2, Upload } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../ui/button.tsx'
import { Input, Select } from '../ui/input.tsx'
import { Popover, PopoverAnchor, PopoverContent } from '../ui/popover.tsx'
import { useEditor } from './store.ts'
import { openProfile } from './sync.ts'

interface Props {
  profiles: Array<{ id: string; name: string }>
  activeId: string
}

function MenuItem({
  icon,
  children,
  danger,
  onClick,
}: {
  icon: ReactNode
  children: ReactNode
  danger?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm transition-colors hover:bg-line [&_svg]:size-4 ${danger ? 'text-signal' : ''}`}
    >
      <span className={danger ? '' : 'text-muted'}>{icon}</span>
      {children}
    </button>
  )
}

export function ProfilePanel({ profiles, activeId }: Props) {
  const profile = useEditor((s) => s.profile)
  const { renameProfile, setNotice } = useEditor.getState()
  const [menu, setMenu] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!profile) return null
  const isActive = profile.id === activeId

  const run = (work: () => Promise<unknown>) => {
    setMenu(false)
    setConfirmDelete(false)
    void work()
  }
  const openNew = async (id: string | undefined) => {
    if (id) await openProfile(id)
  }

  return (
    <section aria-label="Profile" className="space-y-2">
      <div className="flex items-center gap-1">
        <Select
          aria-label="Profile"
          value={profile.id}
          onChange={(e) => void openProfile(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Popover open={menu} onOpenChange={(open) => (setMenu(open), setConfirmDelete(false))}>
          <PopoverAnchor asChild>
            <Button
              size="icon"
              variant="ghost"
              aria-label="Profile actions"
              aria-expanded={menu}
              onClick={() => setMenu(true)}
            >
              <Ellipsis />
            </Button>
          </PopoverAnchor>
          <PopoverContent className="w-60 space-y-1 p-1.5" aria-label="Profile actions">
            <label className="block px-1 pt-1 pb-2">
              <span className="mb-1 block text-xs text-muted">Name</span>
              <Input
                value={profile.name}
                maxLength={40}
                onChange={(e) => renameProfile(e.target.value)}
              />
            </label>
            <MenuItem
              icon={<FilePlus />}
              onClick={() => run(() => window.tessel.createProfile('New profile').then(openNew))}
            >
              New profile
            </MenuItem>
            <MenuItem
              icon={<Copy />}
              onClick={() => run(() => window.tessel.duplicateProfile(profile.id).then(openNew))}
            >
              Duplicate
            </MenuItem>
            <MenuItem
              icon={<Download />}
              onClick={() =>
                run(() =>
                  window.tessel.importProfile().then((r) => {
                    if (r.ok) return openNew(r.id)
                    if ('error' in r) setNotice(r.error)
                  }),
                )
              }
            >
              Import…
            </MenuItem>
            <MenuItem
              icon={<Upload />}
              onClick={() => run(() => window.tessel.exportProfile(profile.id))}
            >
              Export…
            </MenuItem>
            {profiles.length > 1 && (
              <MenuItem
                icon={<Trash2 />}
                danger
                onClick={() =>
                  confirmDelete
                    ? run(() =>
                        window.tessel.deleteProfile(profile.id).then(async () => {
                          await openProfile((await window.tessel.getState()).activeProfileId)
                        }),
                      )
                    : setConfirmDelete(true)
                }
              >
                {confirmDelete ? `Delete “${profile.name}”` : 'Delete…'}
              </MenuItem>
            )}
          </PopoverContent>
        </Popover>
      </div>
      {isActive ? (
        <p className="flex items-center gap-2 text-xs text-muted">
          <span className="size-1.5 rounded-full bg-glaze" aria-hidden /> Phones use this profile
        </p>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="w-full"
          onClick={() => void window.tessel.setActiveProfile(profile.id)}
        >
          Use on phones
        </Button>
      )}
    </section>
  )
}
