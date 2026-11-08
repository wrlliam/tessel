import { useState } from 'react'
import { Button } from '../ui/button.tsx'
import { Input, Select } from '../ui/input.tsx'
import { useEditor } from './store.ts'
import { openProfile } from './sync.ts'

interface Props {
  profiles: Array<{ id: string; name: string }>
  activeId: string
}

export function ProfilePanel({ profiles, activeId }: Props) {
  const profile = useEditor((s) => s.profile)
  const { renameProfile, setNotice } = useEditor.getState()
  const [confirmDelete, setConfirmDelete] = useState(false)
  if (!profile) return null
  const isActive = profile.id === activeId

  async function afterChange(id: string | undefined) {
    if (id) await openProfile(id)
  }

  return (
    <section aria-label="Profile" className="space-y-2">
      <div className="flex items-center gap-2">
        <Select
          aria-label="Profile"
          value={profile.id}
          onChange={(e) => void openProfile(e.target.value)}
        >
          {profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
              {p.id === activeId ? ' · on phones' : ''}
            </option>
          ))}
        </Select>
      </div>
      <Input
        aria-label="Profile name"
        value={profile.name}
        maxLength={40}
        onChange={(e) => renameProfile(e.target.value)}
      />
      {isActive ? (
        <p className="text-xs text-muted">Phones are using this profile.</p>
      ) : (
        <Button
          size="sm"
          variant="primary"
          className="w-full"
          onClick={() => void window.tessel.setActiveProfile(profile.id)}
        >
          Use on phones
        </Button>
      )}
      <div className="flex flex-wrap gap-1">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.tessel.createProfile('New profile').then(afterChange)}
        >
          New
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.tessel.duplicateProfile(profile.id).then(afterChange)}
        >
          Duplicate
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() =>
            void window.tessel.importProfile().then((r) => {
              if (r.ok) return afterChange(r.id)
              if ('error' in r) setNotice(r.error)
            })
          }
        >
          Import
        </Button>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void window.tessel.exportProfile(profile.id)}
        >
          Export
        </Button>
        {profiles.length > 1 &&
          (confirmDelete ? (
            <Button
              size="sm"
              variant="danger"
              onClick={() => {
                setConfirmDelete(false)
                void window.tessel.deleteProfile(profile.id).then(async () => {
                  const state = await window.tessel.getState()
                  await openProfile(state.activeProfileId)
                })
              }}
            >
              Delete “{profile.name}”
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(true)}>
              Delete
            </Button>
          ))}
      </div>
    </section>
  )
}
