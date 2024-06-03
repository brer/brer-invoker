import { importPKCS8, type KeyLike, SignJWT } from 'jose'
import { readFile } from 'node:fs/promises'

const ALG_ASYMMETHRIC = 'RS256'

const ALG_SYMMETHRIC = 'HS256'

export interface Token {
  raw: string
  /**
   * Seconds.
   */
  expiresIn: number
  /**
   * ISO date.
   */
  issuedAt: Date
}

function getAlgorithm(key: KeyLike | Uint8Array) {
  return Symbol.iterator in key ? ALG_SYMMETHRIC : ALG_ASYMMETHRIC
}

/**
 * Returns seconds since UNIX epoch.
 */
function getExpirationTime(date: Date, seconds: number) {
  return Math.floor(date.getTime() / 1000) + seconds
}

/**
 * Token used to authenticate Pod's requests.
 */
export async function signPodToken(
  key: KeyLike | Uint8Array,
  podName: string,
): Promise<Token> {
  const issuedAt = new Date()

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: getAlgorithm(key) })
    .setIssuedAt()
    .setIssuer('brer.io/invoker')
    .setAudience('brer.io/api')
    .setSubject(podName)
    .sign(key)

  return {
    expiresIn: 0, // no expiration
    issuedAt,
    raw,
  }
}

/**
 * Token used to authenticate Invoker's requests.
 */
export async function signInvokerToken(
  key: KeyLike | Uint8Array,
): Promise<Token> {
  const issuedAt = new Date()
  const expiresIn = 30 // seconds

  const raw = await new SignJWT()
    .setProtectedHeader({ alg: getAlgorithm(key) })
    .setIssuedAt()
    .setExpirationTime(getExpirationTime(issuedAt, expiresIn))
    .setIssuer('brer.io/invoker')
    .setAudience('brer.io/api')
    .sign(key)

  return {
    expiresIn,
    issuedAt,
    raw,
  }
}

export type TokenKey = KeyLike | Uint8Array

export interface PluginOptions {
  /**
   * Symmetric secret.
   */
  secret?: string
  /**
   * PKCS8 PEM filepath.
   */
  privateKey?: string
}

export async function importKey(options: PluginOptions): Promise<TokenKey> {
  if (options.privateKey) {
    return importPKCS8(
      await readFile(options.privateKey, 'utf-8'),
      ALG_ASYMMETHRIC,
    )
  } else if (options.secret) {
    return Buffer.from(options.secret)
  } else {
    throw new Error('Specify JWT secret or certificate')
  }
}
