import { Pool } from 'undici'

import type { Invocation } from './invocation.js'
import { TokenKey, signInvokerToken, signPodToken } from './token.js'

export function createPool(url: string | undefined) {
  if (!url) {
    throw new Error('Expected API server URL')
  }

  return new Pool(url, {
    connections: 32,
    headersTimeout: 10000,
    pipelining: 1,
  })
}

export async function readActiveInvocations(
  pool: Pool,
  tokenKey: TokenKey,
  maxActiveInvocations: number,
): Promise<Invocation[]> {
  // TODO: reuse token
  const token = await signInvokerToken(tokenKey)

  const response = await pool.request({
    method: 'GET',
    path: `/api/v1/invocations`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json',
    },
    query: {
      direction: 'asc', // by creation date
      limit: maxActiveInvocations,
      status: 'active',
    },
  })

  const data: any = await response.body.json()

  if (response.statusCode === 200) {
    return data.invocations
  } else {
    throw new Error(
      `Invocations list returned status code ${response.statusCode}`,
    )
  }
}

/**
 * Update whole Invocation.
 */
export async function failTimedOutInvocation(
  pool: Pool,
  tokenKey: TokenKey,
  invocation: Invocation,
): Promise<void> {
  const token = await signPodToken(tokenKey, invocation.pod)

  const response = await pool.request({
    method: 'PUT',
    path: `/api/v1/invocations/${invocation.ulid}`,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${token.raw}`,
      'content-type': 'application/json',
      'if-match': invocation._rev || 'invalid_rev',
    },
    body: JSON.stringify({
      ...invocation,
      status: 'failed',
      reason: 'timed out',
    }),
  })

  await response.body.json()

  if (response.statusCode !== 200) {
    throw new Error(
      `Invocation ${invocation.ulid} update returned status code ${response.statusCode}`,
    )
  }
}
