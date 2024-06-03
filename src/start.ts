import closeWithGrace from 'close-with-grace'
import Pino from 'pino'

import { invoke } from './lib/invoke.js'
import { setupKubernetes } from './lib/kubernetes.js'
import { createPool, readActiveInvocations } from './lib/pool.js'
import { importKey } from './lib/token.js'

const log = Pino.default({
  level: process.env.LOG_LEVEL || 'debug',
  transport:
    process.env.LOG_PRETTY === 'enable'
      ? {
          target: 'pino-pretty',
          options: {
            translateTime: true,
          },
        }
      : {
          target: 'pino/file',
          options: {
            destination: process.env.LOG_FILE || process.stdout.fd,
          },
        },
})

/**
 * Promises are supported
 */
type TeardownHandler = () => any

const teardown: TeardownHandler[] = []

async function bootstrap() {
  const maxActiveInvocations = parseInt(
    process.env.MAX_ACTIVE_INVOCATIONS || '10',
  )
  if (!isPositiveInteger(maxActiveInvocations)) {
    throw new TypeError(
      'Max active Invocations value shoud be a positive integer',
    )
  }
  if (maxActiveInvocations > 100) {
    throw new Error('Unsupported active Invocations value')
  }

  // Seconds
  const invokeTimeout = parseInt(process.env.INVOKE_TIMEOUT || '10')
  if (!isPositiveInteger(invokeTimeout)) {
    throw new TypeError('Invoke timeout value shoud be a positive integer')
  }

  log.debug('import token key')
  const tokenKey = await importKey({
    privateKey: process.env.JWT_PRIVATE_KEY,
    secret: process.env.JWT_SECRET,
  })

  const pool = createPool(process.env.API_URL)
  teardown.push(() => pool.close())

  log.debug('test api pool')
  await readActiveInvocations(pool, tokenKey, 1)

  const kubernetes = setupKubernetes({
    cluster: process.env.K8S_CLUSTER,
    context: process.env.K8S_CONTEXT,
    file: process.env.K8S_FILE,
    namespace: process.env.K8S_NAMESPACE,
    user: process.env.K8S_USER,
    yaml: process.env.K8S_YAML,
  })

  let promise: Promise<unknown> | null = null

  const callback = () => {
    if (promise) {
      return log.warn('invoker is busy')
    }

    log.info('invoke pods')
    promise = invoke({
      apiUrl: process.env.API_URL!,
      imagePullSecrets: process.env.K8S_PULL_SECRETS
        ? process.env.K8S_PULL_SECRETS.split(',')
        : [],
      kubernetes,
      log,
      maxActiveInvocations,
      pool,
      tokenKey,
    }).then(
      () => {
        promise = null
        log.info('pods invoked')
      },
      err => {
        promise = null
        log.error({ err }, 'invoke error')
      },
    )
  }

  const timer = setInterval(callback, invokeTimeout * 1000)

  teardown.push(async () => {
    // Close current watch request
    clearInterval(timer)

    log.info('waiting for pending jobs')
    await promise
  })

  callback()
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0
}

const closeListeners = closeWithGrace(
  {
    delay: 10000,
    logger: log,
  },
  async ({ err, signal }) => {
    if (err !== undefined) {
      log.error({ err }, 'closing because of error')
    } else if (signal !== undefined) {
      log.info({ signal }, 'received close signal')
    } else {
      log.info('application closed manually')
    }

    for (const fn of teardown.reverse()) {
      try {
        await fn()
      } catch (err) {
        log.warn({ err }, 'teardown failed')
      }
    }
  },
)

log.info('bootstrap application')
bootstrap().then(
  () => {
    log.info('application is running')
  },
  err => {
    log.fatal({ err }, 'bootstrap failed')
    closeListeners.close()
  },
)
