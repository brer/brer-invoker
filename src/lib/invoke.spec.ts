import test from 'ava'

import { invoke } from './invoke.js'

test('noop', async t => {
  t.plan(1)

  const app: any = {
    tokenKey: Buffer.from('super_secret'),
    pool: {
      async request(options: any) {
        t.like(options, {
          method: 'GET',
          path: '/api/v1/invocations',
        })

        return {
          statusCode: 200,
          body: {
            async json() {
              return {
                invocations: [],
              }
            },
          },
        }
      },
    },
  }

  await invoke(app)
})
