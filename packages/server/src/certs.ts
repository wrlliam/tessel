// A small certificate authority per install, so phones can reach Tessel over https:// on the LAN.
// The phone installs the CA once; the server certificate is reissued whenever the computer's
// addresses change or it nears expiry, and phones keep trusting it.
import { generateKeyPairSync, randomBytes, X509Certificate } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { isIP } from 'node:net'
import { hostname } from 'node:os'
import { join } from 'node:path'
import forge from 'node-forge'
import type { TlsCredentials } from './server.ts'

const CA_YEARS = 10
/** Apple refuses TLS server certificates valid for more than 398 days. */
const SERVER_DAYS = 397
const RENEW_WITHIN_MS = 30 * 24 * 60 * 60 * 1000

interface Pem {
  key: string
  cert: string
}

function newKey() {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  })
  return {
    pem: privateKey,
    privateKey: forge.pki.privateKeyFromPem(privateKey),
    publicKey: forge.pki.publicKeyFromPem(publicKey),
  }
}

/** Positive, random serial number. */
function serial(): string {
  const bytes = randomBytes(16)
  bytes[0] = (bytes[0] ?? 0) & 0x7f
  return bytes.toString('hex')
}

export function createCa(name = hostname()): Pem {
  const key = newKey()
  const cert = forge.pki.createCertificate()
  cert.publicKey = key.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date(Date.now() - 60_000)
  cert.validity.notAfter = new Date(Date.now() + CA_YEARS * 365 * 24 * 60 * 60 * 1000)
  const subject = [
    { name: 'commonName', value: `Tessel on ${name}`.slice(0, 64) },
    { name: 'organizationName', value: 'Tessel (local)' },
  ]
  cert.setSubject(subject)
  cert.setIssuer(subject)
  cert.setExtensions([
    { name: 'basicConstraints', cA: true, pathLenConstraint: 0, critical: true },
    { name: 'keyUsage', keyCertSign: true, cRLSign: true, critical: true },
    { name: 'subjectKeyIdentifier' },
  ])
  cert.sign(key.privateKey, forge.md.sha256.create())
  return { key: key.pem, cert: forge.pki.certificateToPem(cert) }
}

/** A server certificate for these IP addresses and host names, signed by the CA. */
export function issueServerCert(ca: Pem, names: string[]): Pem {
  const caCert = forge.pki.certificateFromPem(ca.cert)
  const caKey = forge.pki.privateKeyFromPem(ca.key)
  const key = newKey()
  const cert = forge.pki.createCertificate()
  cert.publicKey = key.publicKey
  cert.serialNumber = serial()
  cert.validity.notBefore = new Date(Date.now() - 60_000)
  cert.validity.notAfter = new Date(Date.now() + SERVER_DAYS * 24 * 60 * 60 * 1000)
  cert.setSubject([{ name: 'commonName', value: (names[0] ?? 'localhost').slice(0, 64) }])
  cert.setIssuer(caCert.subject.attributes)
  cert.setExtensions([
    { name: 'basicConstraints', cA: false, critical: true },
    { name: 'keyUsage', digitalSignature: true, keyEncipherment: true, critical: true },
    { name: 'extKeyUsage', serverAuth: true },
    {
      name: 'subjectAltName',
      altNames: names.map((n) => (isIP(n) ? { type: 7, ip: n } : { type: 2, value: n })),
    },
    { name: 'subjectKeyIdentifier' },
    {
      name: 'authorityKeyIdentifier',
      keyIdentifier: caCert.generateSubjectKeyIdentifier().getBytes(),
    },
  ])
  cert.sign(caKey, forge.md.sha256.create())
  return { key: key.pem, cert: forge.pki.certificateToPem(cert) }
}

/** True when the certificate was signed by the CA, covers every name and isn't about to expire. */
export function serverCertFits(cert: string, ca: string, names: string[], now = Date.now()) {
  try {
    const x = new X509Certificate(cert)
    if (!x.checkIssued(new X509Certificate(ca))) return false
    if (new Date(x.validTo).getTime() - now < RENEW_WITHIN_MS) return false
    return names.every((n) => (isIP(n) ? x.checkIP(n) : x.checkHost(n)) !== undefined)
  } catch {
    return false
  }
}

const read = (file: string) => readFile(file, 'utf8').catch(() => undefined)

/**
 * Loads the CA and server certificate from `dir`, creating or renewing them as needed.
 * Private keys are written readable by this user only.
 */
export async function ensureTls(dir: string, names: string[]): Promise<TlsCredentials> {
  await mkdir(dir, { recursive: true, mode: 0o700 })
  const all = [...new Set(['localhost', '127.0.0.1', ...names])]
  let ca: Pem | undefined
  const [caKey, caCert] = await Promise.all([read(join(dir, 'ca.key')), read(join(dir, 'ca.crt'))])
  if (caKey && caCert) ca = { key: caKey, cert: caCert }
  else {
    ca = createCa()
    await writeFile(join(dir, 'ca.key'), ca.key, { mode: 0o600 })
    await writeFile(join(dir, 'ca.crt'), ca.cert)
  }
  const [key, cert] = await Promise.all([
    read(join(dir, 'server.key')),
    read(join(dir, 'server.crt')),
  ])
  if (key && cert && serverCertFits(cert, ca.cert, all)) return { key, cert, ca: ca.cert }
  const server = issueServerCert(ca, all)
  await writeFile(join(dir, 'server.key'), server.key, { mode: 0o600 })
  await writeFile(join(dir, 'server.crt'), server.cert)
  return { ...server, ca: ca.cert }
}
