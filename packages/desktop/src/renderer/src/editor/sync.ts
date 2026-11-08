import { useEffect } from 'react'
import { findTile, useEditor } from './store.ts'

const SAVE_DELAY_MS = 500
const VALIDATE_DELAY_MS = 200

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Saves the draft now. Test Run and profile switches call this so nothing is lost. */
export async function saveNow(): Promise<boolean> {
  clearTimeout(saveTimer)
  const { profile, save, setSave } = useEditor.getState()
  if (!profile || save.kind === 'saved') return true
  const result = await window.tessel.saveProfile(profile)
  // Only mark saved if nothing changed while the save was in flight.
  if (useEditor.getState().profile === profile) {
    setSave(result.ok ? { kind: 'saved' } : { kind: 'error', message: result.error })
  }
  return result.ok
}

/** Saves the current profile, then loads another into the editor. */
export async function openProfile(id: string) {
  await saveNow()
  const profile = await window.tessel.getProfile(id)
  if (profile) useEditor.getState().open(profile)
}

/** Loads blocks and the starting profile, then keeps the editor in step with the main process. */
export function useEditorSync(startProfileId: string) {
  useEffect(() => {
    let live = true
    void window.tessel.getBlocks().then((blocks) => {
      if (!live) return
      useEditor.getState().setBlocks(blocks)
      if (!useEditor.getState().profile) void openProfile(startProfileId)
    })
    const offEngine = window.tessel.onEngineEvent((e) => useEditor.getState().applyEngineEvent(e))
    const offPhoneEdit = window.tessel.onPhoneEdit((e) => useEditor.getState().applyPhoneEdit(e))

    const offSave = useEditor.subscribe((s, prev) => {
      if (s.profile === prev.profile || s.save.kind !== 'pending') return
      clearTimeout(saveTimer)
      saveTimer = setTimeout(() => void saveNow(), SAVE_DELAY_MS)
    })

    let validateTimer: ReturnType<typeof setTimeout> | undefined
    const offValidate = useEditor.subscribe((s, prev) => {
      const graph = findTile(s.profile, s.selectedTileId)?.graph
      const before = findTile(prev.profile, prev.selectedTileId)?.graph
      if (graph === before) return
      clearTimeout(validateTimer)
      if (!graph) return
      validateTimer = setTimeout(() => {
        void window.tessel.validateGraph(graph).then((issues) => {
          const now = useEditor.getState()
          if (findTile(now.profile, now.selectedTileId)?.graph === graph) now.setIssues(issues)
        })
      }, VALIDATE_DELAY_MS)
    })

    return () => {
      live = false
      offEngine()
      offPhoneEdit()
      offSave()
      offValidate()
      clearTimeout(validateTimer)
      void saveNow()
    }
    // Only the first profile matters here; later switches go through openProfile.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
}
