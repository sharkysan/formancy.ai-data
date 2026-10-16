/*
 * What the live demo's image promises whoever starts it -- the Worker's
 * Durable Object on Cloudflare, the image's gate locally: where its server
 * listens, and which variable it reads its identity key from. Held to
 * deploy/demo/Dockerfile by dockerfile.test.ts.
 */

/** The port the image's data server listens on, as its ENV PORT and EXPOSE say. */
export const SERVER_PORT = 4390

/**
 * The environment variable the image's FORMANCY_DATA_IDENTITY_SECRET names
 * (`env:` it), which the starter sets to a new key on every start, so a
 * token from before a restart is refused by the next.
 */
export const IDENTITY_SECRET_VARIABLE = 'FORMANCY_DATA_DEMO_IDENTITY_SECRET'
