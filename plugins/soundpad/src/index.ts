import { connect } from 'node:net'
import { createSoundpadPlugin } from './plugin.ts'

const PIPE = '\\\\.\\pipe\\sp_remote_control'

/** One command per connection: write it, read the reply. */
function send(command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = connect(PIPE)
    let reply = ''
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('Soundpad did not answer'))
    }, 5000)
    socket.on('connect', () => socket.write(command))
    socket.on('data', (d) => {
      reply += d.toString('utf8')
      // Replies are short codes, or one XML document for the sound list.
      if (!reply.startsWith('<') || reply.trimEnd().endsWith('>')) {
        clearTimeout(timer)
        socket.end()
        resolve(reply)
      }
    })
    socket.on('error', (err) => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

export default createSoundpadPlugin(send)
