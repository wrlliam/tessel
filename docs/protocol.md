# Tessel phone protocol

Version: **1** (`PROTOCOL_VERSION` in `packages/core/src/protocol.ts`, which is the source of truth; zod schemas there validate every message).

The phone is a thin remote. It may only say "tile X was pressed". It never sends commands, paths or scripts, and it never receives tile graphs.

## Transport

- HTTP and WebSocket on the desktop's LAN address, default port `4747`, only while **Allow phones** is on.
- Advertised over mDNS as `_tessel._tcp` with TXT `protocol=1`.
- Every request must use a `Host` that is an IP literal, `localhost` or a `*.local` name (anything else gets `421`), which blocks DNS rebinding.
- `POST /api/pair` and the WebSocket upgrade must carry an `Origin` matching the `Host` (`403` otherwise).

## Pairing (HTTP)

`POST /api/pair`

```json
{ "code": "482913", "deviceName": "iPhone" }
```

| Status | Meaning                                                                                                                                                           |
| ------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `200`  | `{ "deviceId": "…", "token": "…" }`, where the token is 256 random bits in base64url. The phone stores it in `localStorage`; the desktop stores only its SHA-256. |
| `400`  | Body is not a 6-digit code plus name.                                                                                                                             |
| `401`  | Wrong code.                                                                                                                                                       |
| `403`  | Bad `Origin`.                                                                                                                                                     |
| `429`  | 5 wrong codes from one IP within 10 minutes. `Retry-After` header in seconds.                                                                                     |

The code lasts 5 minutes, is single-use, and is replaced after 20 wrong guesses from any IPs.

`GET /api/health` returns `{ "ok": true, "protocol": 1 }`.

## WebSocket `/ws`

JSON text frames, max 4 KB from the phone, max 40 messages per second (more closes with `1008`). The first message must be `hello`, sent within 5 seconds.

### Phone → desktop

| Message      | Fields                                                    | Notes                                                 |
| ------------ | --------------------------------------------------------- | ----------------------------------------------------- |
| `hello`      | `protocol: number`, `token: string`, `deviceName: string` | Desktop answers with `profile`, or `error` and close. |
| `press`      | `tileId: string`, `phase: 'down' \| 'up'`                 | Unknown tile ids are ignored.                         |
| `pageChange` | `pageId: string`                                          | The phone moved to another page.                      |
| `ping`       | `t: number`                                               | Answered by `pong` with the same `t`.                 |

### Desktop → phone

| Message      | Fields                                                                    | Notes                                                                 |
| ------------ | ------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `profile`    | `profile: PhoneProfile`                                                   | Pages and tiles without graphs. Re-sent whenever the profile changes. |
| `tileState`  | `tileId`, optional `label`, `colour`, `icon`                              | Live appearance override.                                             |
| `pageChange` | `pageId: string`                                                          | Desktop asks the phone to show a page.                                |
| `pong`       | `t: number`                                                               |                                                                       |
| `error`      | `code: 'unauthorized' \| 'protocol-mismatch' \| 'bad-message'`, `message` | Human-readable message.                                               |

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
