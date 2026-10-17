// Module resolution for the live demo's gate (0070): `cloudflare:workers`,
// which only Cloudflare's runtime has, is workers.mjs. Registered with
// node:module's register() by cloudflare.mjs before it imports the Worker;
// every other specifier resolves as Node resolves it.

const WORKERS = new URL('./workers.mjs', import.meta.url).href

export async function resolve(specifier, context, next) {
  if (specifier === 'cloudflare:workers') return { url: WORKERS, shortCircuit: true }
  return next(specifier, context)
}
