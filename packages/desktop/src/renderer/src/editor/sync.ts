import { useEffect } from 'react'
import { findTile, useEditor } from './store.ts'

const SAVE_DELAY_MS = 500
const VALIDATE_DELAY_MS = 200

let saveTimer: ReturnType<typeof setTimeout> | undefined

/** Saves the draft now. Test Run calls this so it always runs what you see. */
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

/** Loads the profile and keeps the editor in step with the main process. */
export function useEditorSync() {
  useEffect(() => {
    let live = true
    void Promise.all([window.tessel.getProfile(), window.tessel.getBlocks()]).then(
      ([profile, blocks]) => {
        if (live) useEditor.getState().load(profile, blocks)
      },
    )
    const offEngine = window.tessel.onEngineEvent((e) => useEditor.getState().applyEngineEvent(e))

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
          if (
            findTile(useEditor.getState().profile, useEditor.getState().selectedTileId)?.graph ===
            graph
          ) {
            useEditor.getState().setIssues(issues)
          }
        })
      }, VALIDATE_DELAY_MS)
    })

    return () => {
      live = false
      offEngine()
      offSave()
      offValidate()
      clearTimeout(validateTimer)
      void saveNow()
    }
  }, [])
}
