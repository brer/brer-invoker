import type { V1EnvVar, V1Pod } from '@kubernetes/client-node'
import type { Logger } from 'pino'
import type { Pool } from 'undici'

import type { Invocation, InvocationImage } from './invocation.js'
import type { Kubernetes } from './kubernetes.js'
import { failTimedOutInvocation, readActiveInvocations } from './pool.js'
import { TokenKey, signPodToken } from './token.js'

export interface App {
  apiUrl: string
  imagePullSecrets: string[]
  kubernetes: Kubernetes
  log: Logger
  maxActiveInvocations: number
  pool: Pool
  tokenKey: TokenKey
}

/**
 * Reconcile by Invocation identifier.
 */
export async function invoke(app: App): Promise<void> {
  const invocations = await readActiveInvocations(
    app.pool,
    app.tokenKey,
    app.maxActiveInvocations,
  )

  await Promise.all(invocations.map(obj => reconcileInvocation(app, obj)))
}

async function reconcileInvocation(
  app: App,
  invocation: Invocation,
): Promise<unknown> {
  const { apiUrl, kubernetes, imagePullSecrets, log, pool, tokenKey } = app

  if (hasTimedOut(invocation)) {
    log.debug({ invocationUlid: invocation.ulid }, 'invocation timeout')
    await failTimedOutInvocation(pool, tokenKey, invocation)
    return
  }

  if (invocation.status !== 'pending') {
    log.trace({ invocationUlid: invocation.ulid }, 'ignore invocation')
    return
  }

  const pod = await readPod(kubernetes, invocation.pod)
  if (!pod) {
    const token = await signPodToken(tokenKey, invocation.pod)

    log.debug({ invocationUlid: invocation.ulid }, 'create invocation pod')
    try {
      await kubernetes.api.createNamespacedPod(
        kubernetes.namespace,
        getPodTemplate(apiUrl, invocation, token.raw, imagePullSecrets),
      )
    } catch (err) {
      if (Object(err).statusCode === 409) {
        log.trace('pod already created')
      } else {
        return Promise.reject(err)
      }
    }
  }
}

/**
 * Read Pod by name.
 */
async function readPod(
  { api, namespace }: Kubernetes,
  podName: string,
): Promise<V1Pod | null> {
  try {
    const response = await api.readNamespacedPod(podName, namespace)
    return response.body
  } catch (err) {
    if (Object(err).statusCode === 404) {
      return null
    } else {
      return Promise.reject(err)
    }
  }
}

function getPodTemplate(
  apiUrl: string,
  invocation: Invocation,
  token: string,
  imagePullSecrets: string[],
): V1Pod {
  const env: V1EnvVar[] = [
    { name: 'BRER_URL', value: apiUrl },
    { name: 'BRER_TOKEN', value: token },
    { name: 'BRER_INVOCATION_ID', value: invocation.ulid },
  ]
  if (invocation.runtimeTest) {
    env.push({ name: 'BRER_MODE', value: 'test' })
  }

  for (const item of invocation.env) {
    env.push(
      item.secretKey
        ? {
            name: item.name,
            valueFrom: {
              secretKeyRef: {
                name: item.secretName,
                key: item.secretKey,
              },
            },
          }
        : {
            name: item.name,
            value: item.value,
          },
    )
  }

  const cpuRequest =
    invocation.resources?.requests?.cpu || process.env.K8S_CPU_REQUEST

  const memoryRequest =
    invocation.resources?.requests?.memory || process.env.K8S_MEMORY_REQUEST

  const cpuLimit =
    invocation.resources?.limits?.cpu || process.env.K8S_CPU_LIMIT

  const memoryLimit =
    invocation.resources?.limits?.memory || process.env.K8S_MEMORY_LIMIT

  const resources: any = {}
  if (cpuRequest || memoryRequest) {
    resources.request = {}
    if (cpuRequest) {
      resources.request.cpu = cpuRequest
    }
    if (memoryRequest) {
      resources.request.memory = memoryRequest
    }
  }
  if (cpuLimit || memoryLimit) {
    resources.limit = {}
    if (cpuLimit) {
      resources.limit.cpu = cpuLimit
    }
    if (memoryLimit) {
      resources.limit.memory = memoryLimit
    }
  }

  return {
    apiVersion: 'v1',
    kind: 'Pod',
    metadata: {
      creationTimestamp: new Date(),
      name: invocation.pod,
      labels: {
        'app.kubernetes.io/managed-by': 'brer.io',
        'brer.io/function-name': invocation.functionName,
        'brer.io/invocation-ulid': invocation.ulid,
        'brer.io/project': invocation.project,
      },
      finalizers: ['brer.io/invocation-protection'],
    },
    spec: {
      automountServiceAccountToken: false,
      restartPolicy: 'Never',
      containers: [
        {
          name: 'job',
          image: serializeImage(invocation.image),
          imagePullPolicy:
            invocation.image.tag === 'latest' ? 'Always' : 'IfNotPresent',
          env,
          resources,
        },
      ],
      imagePullSecrets: imagePullSecrets.map(v => ({ name: v })),
    },
  }
}

function serializeImage(image: InvocationImage): string {
  return `${image.host}/${image.name}:${image.tag}`
}

function hasTimedOut(invocation: Invocation): boolean {
  switch (invocation.status) {
    case 'initializing':
      // 10 minutes of delay before considering a runtime failure
      return isOlderThan(
        invocation.phases[invocation.phases.length - 1].date,
        600,
      )
    case 'running':
      // Timeout since running phase
      return invocation.timeout
        ? isOlderThan(
            invocation.phases[invocation.phases.length - 1].date,
            invocation.timeout,
          )
        : false
    default:
      return false
  }
}

function isOlderThan(iso: string, seconds: number) {
  return new Date(iso).getTime() < Date.now() - seconds * 1000
}
