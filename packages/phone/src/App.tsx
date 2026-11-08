import { useState } from 'react'
import { clearToken, loadToken, saveToken } from './device.ts'
import { PairScreen } from './PairScreen.tsx'
import { Surface } from './Surface.tsx'

export function App() {
  const [token, setToken] = useState(loadToken)
  const [notice, setNotice] = useState<string>()

  if (!token) {
    return (
      <PairScreen
        notice={notice}
        onPaired={(t) => {
          saveToken(t)
          setNotice(undefined)
          setToken(t)
        }}
      />
    )
  }
  return (
    <Surface
      key={token}
      token={token}
      onUnpaired={(reason) => {
        clearToken()
        setNotice(reason ?? 'This phone was removed on your computer. Pair again to continue.')
        setToken(null)
      }}
    />
  )
}
