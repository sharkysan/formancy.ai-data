/*
 * Publishes the demo's forms at the image's build: `node
 * /tools/dist/image/cli.mjs`, as deploy/demo/build.sh runs it beside the
 * server it started for that, on 127.0.0.1. A composition root: the
 * publishing is publish.ts's, which publish.integration.test.ts runs against
 * the real server over the files the image loads.
 *
 * It reads three settings, from the environment of that one RUN:
 *
 *   FORMANCY_DATA_DEMO_BUILD_KEY   the key the build-time server verifies with, which nothing writes to a file
 *   FORMANCY_DATA_ADMIN_ROLES      the server's own setting: its first role is the one this signs for
 *   PORT                           the server's own setting, default 4390
 *
 * Prints one line per form and its generator's notes; prints a sentence and
 * exits 1 on the first refusal. Neither ever holds the key or the token.
 */
import { mintToken } from '../token.js'
import { publishDemoForms, waitForHealth } from './publish.js'

const key = process.env['FORMANCY_DATA_DEMO_BUILD_KEY'] ?? ''
const role = (process.env['FORMANCY_DATA_ADMIN_ROLES'] ?? '').split(',')[0]?.trim() ?? ''
const base = `http://127.0.0.1:${process.env['PORT'] ?? '4390'}`

try {
  if (key === '') throw new Error('FORMANCY_DATA_DEMO_BUILD_KEY is required: the key the build-time server verifies with.')
  if (role === '') throw new Error('FORMANCY_DATA_ADMIN_ROLES is required: the role the build-time server administers with.')
  const waited = await waitForHealth(base)
  console.log(`publish: the server answered /health after ${String(waited)} ms`)
  const { token } = await mintToken(key, { subject: 'image-build', roles: [role] })
  for (const form of await publishDemoForms({ base, token })) {
    console.log(`publish: ${form.id} as ${form.account} in ${String(form.milliseconds)} ms`)
    for (const note of form.notes) console.log(`  ${note.kind} ${note.subject}: ${note.message}`)
  }
} catch (error) {
  console.error(`publish: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
}
