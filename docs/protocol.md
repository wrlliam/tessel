# Tessel phone protocol

Version: **2** (`PROTOCOL_VERSION` in `packages/core/src/protocol.ts`, which is the source of truth; zod schemas there validate every message).

The phone is a thin remote. It may only say "tile X was pressed". It never sends commands, paths or scripts, and it never receives tile graphs.

## Transport

- HTTP and WebSocket on the desktop's LAN address, default port `4747`, only while **Allow phones** is on.
- Advertised over mDNS as `_tessel._tcp` with TXT `protocol=2`.
- Every request must use a `Host` that is an IP literal, `localhost` or a `*.local` name (anything else gets `421`), which blocks DNS rebinding.
- `POST /api/pair` and the WebSocket upgrade must carry an `Origin` matching the `Host` (`403` otherwise).

## Pairing (HTTP)

`POST /api/pair`

```json
{ "code": "482913", "deviceName": "iPhone", "previousToken": "…optional" }
```

| Status | Meaning                                                                                                    |
| ------ | ---------------------------------------------------------------------------------------------------------- |
| `202`  | `{ "requestId": "…", "secret": "…" }`: the code was right and the computer now asks someone to approve.    |
| `400`  | Body is not a 6-digit code plus name.                                                                      |
| `401`  | Wrong code.                                                                                                |
| `403`  | Bad `Origin`.                                                                                              |
| `429`  | 5 wrong codes from one IP within 10 minutes, or 3 phones already waiting. `Retry-After` header in seconds. |

The right code never hands out a token by itself. The phone then long-polls:

`POST /api/pair/wait` with `{ "requestId", "secret" }`, held up to 25 s.

| Status | Meaning                                                                                                                                                                            |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | `{ "status": "pending" }`: ask again; or `{ "deviceId", "token" }` once approved. The token is 256 random bits in base64url; the desktop stores only its SHA-256. Handed out once. |
| `403`  | Refused on the computer.                                                                                                                                                           |
| `404`  | Unknown request or wrong secret.                                                                                                                                                   |
| `410`  | Nobody approved it within 2 minutes.                                                                                                                                               |

One request waits per address; asking again replaces it. When `previousToken` belongs to a paired phone, approving the new pairing removes that old one.

The code lasts 5 minutes, is single-use, and is replaced after 20 wrong guesses from any IPs.

`GET /api/health` returns `{ "ok": true, "protocol": 2 }`.

## WebSocket `/ws`

JSON text frames, max 4 KB from the phone, max 40 messages per second (more closes with `1008`). The first message must be `hello`, sent within 5 seconds.

### Phone → desktop

| Message          | Fields                                                    | Notes                                                                |
| ---------------- | --------------------------------------------------------- | -------------------------------------------------------------------- |
| `hello`          | `protocol: number`, `token: string`, `deviceName: string` | Desktop answers with `profile`, or `error` and close.                |
| `press`          | `tileId: string`, `phase: 'down' \| 'up'`                 | Unknown tile ids are ignored.                                        |
| `pageChange`     | `pageId: string`                                          | The phone moved to another page.                                     |
| `ping`           | `t: number`                                               | Answered by `pong` with the same `t`.                                |
| `historyRequest` | `tileId`, optional `before: number` (ms)                  | Chart points before that time, or the latest. Answered by `history`. |

### Desktop → phone

| Message         | Fields                                                                                      | Notes                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `profile`       | `profile: PhoneProfile`                                                                     | Pages and tiles without graphs. Re-sent whenever the profile changes.                                                              |
| `phoneSettings` | `settings: PhoneSettings`                                                                   | How the phone looks and behaves. Sent on connect and when changed.                                                                 |
| `tileState`     | `tileId`, optional `label`, `colour`, `icon`, `image`, `value`, `active`, `meter`, `sample` | Live appearance override. `meter` is `{ value, colour, text }` for display tiles; `sample` is one new chart point `[time, value]`. |
| `history`       | `tileId`, `points: [time, value][]`, `more`, optional `before`, `keepMinutes`               | Chart points, oldest first: the latest on connect, older ones when asked.                                                          |
| `pageChange`    | `pageId: string`                                                                            | Desktop asks the phone to show a page.                                                                                             |
| `pong`          | `t: number`                                                                                 |                                                                                                                                    |
| `error`         | `code: 'unauthorized' \| 'protocol-mismatch' \| 'bad-message'`, `message`                   | Human-readable message.                                                                                                            |

### Close codes

| Code   | Meaning                       | Phone does                                                   |
| ------ | ----------------------------- | ------------------------------------------------------------ |
| `4401` | No hello, or unknown token    | Forget token, show pairing                                   |
| `4403` | Device removed on the desktop | Forget token, show pairing                                   |
| `4400` | Protocol version mismatch     | Show "Update needed", stop retrying                          |
| `4503` | Desktop stopped sharing       | Reconnect with backoff                                       |
| other  | Network drop                  | Reconnect with backoff (0.5 s doubling to 10 s, with jitter) |

### Liveness

The desktop sends WebSocket pings every 15 s and drops sockets that miss one. The phone sends `ping` every 10 s and reconnects if no `pong` arrives within 4 s, which catches sockets that died while the phone slept.

## Phone settings

`PhoneSettings` (all fields have defaults, so older desktops can omit them):

| Field       | Values                             | Default   |
| ----------- | ---------------------------------- | --------- |
| `theme`     | `system`, `dark`, `light`          | `system`  |
| `keyStyle`  | `tinted`, `solid`                  | `tinted`  |
| `labels`    | boolean                            | `true`    |
| `labelSize` | `small`, `regular`, `large`        | `regular` |
| `spacing`   | `compact`, `regular`, `roomy`      | `regular` |
| `haptics`   | boolean                            | `true`    |
| `keepAwake` | boolean                            | `true`    |
| `dimLevel`  | integer 20–90 (overlay opacity, %) | `60`      |
| `landscape` | `fill`, `fit`, `rotate`            | `fill`    |
| `header`    | boolean                            | `true`    |

The phone caches the last settings and applies them before it connects.

## Pages and folders

Pages with `kind: 'page'` are swiped between in profile order. Folder pages are opened by a folder tile and are not part of the swipe order. The phone draws a Back tile in the top-left slot of every folder page, so desktops never put a tile there. Folder navigation happens on the phone; the desktop only hears about it through `pageChange`.

Taps fire when the finger lifts, or after 150 ms of holding still, so a swipe that starts on a tile never presses it. The phone sends `press down` and `press up` together for quick taps.
