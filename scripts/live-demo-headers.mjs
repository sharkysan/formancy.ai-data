// The headers the live demo's page is served with on formancy.ai (0070), in
// one place: scripts/live-demo.mjs writes them as the `_headers` file
// Workers Static Assets read from the root of the assets directory, and
// scripts/live-demo.test.mjs reads that file back as Cloudflare's
// documentation describes the format. They are the examples page's (0069,
// scripts/demo-headers.mjs) with one difference, which is the point of
// this file: the policy allows inline styles.
//
// Why: the host page draws its records in an AG Grid Community 36.2.0
// grid, and AG Grid applies its theme by creating `<style>` elements at run
// time (ag-stack@36.2.0, dist/package/main.esm.mjs, `_injectGlobalCSS`),
// with a nonce only when `styleNonce` is given. `style-src 'self'` refuses
// every one of them, and the grid draws unstyled. A hash would have to be
// read from a browser and would change with every grid upgrade; a nonce
// needs code on each page response, which static assets do not run. So
// `'unsafe-inline'` is added to style-src and nothing else changes: scripts
// stay `'self'` alone, and img-src, font-src and connect-src still keep an
// injected style from loading anything from another host.
//
// The Worker's own answers -- the session, its refusals, its 404 -- are not
// covered by `_headers` (Cloudflare's static-assets documentation: the file
// is not applied to a response a Worker makes); the Worker sets its own
// (apps/live-demo/src/worker/answers.ts).

import { headerRules, headersFile, POLICY } from './demo-headers.mjs'

/** The one source the live demo's policy allows beyond the examples page's, by directive: what policyProblems is told not to refuse. */
export const LIVE_ALLOWED = Object.freeze({ 'style-src': Object.freeze(["'unsafe-inline'"]) })

/**
 * The live demo's Content-Security-Policy: 0069's POLICY with
 * `'unsafe-inline'` added to style-src, and nothing else changed.
 * `connect-src 'self'` covers the session and the runtime plane, which are
 * on the page's own origin.
 */
export const LIVE_POLICY = Object.freeze({ ...POLICY, 'style-src': Object.freeze([...POLICY['style-src'], ...LIVE_ALLOWED['style-src']]) })

/** The rules for the page served under `base` (`/data/demo/`): 0069's, with the live policy. */
export function liveHeaderRules(base) {
  return headerRules(base, LIVE_POLICY)
}

/** The rules as the `_headers` file the deploy stages. */
export function liveHeadersFile(base) {
  return headersFile(liveHeaderRules(base), 'scripts/live-demo.mjs from scripts/live-demo-headers.mjs (0070)')
}
