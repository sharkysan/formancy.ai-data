/*
 * The live demo's Worker in numbers, in one place: where it is served, how
 * long a visitor's server outlives their last request, how many run at once
 * and how long a start may take. scripts/live-demo.test.mjs holds PREFIX and
 * MAX_INSTANCES to apps/live-demo/wrangler.json's routes and container, and
 * the sentences the Worker answers with are derived from these, so neither
 * the config nor what a visitor reads can drift from what the code does.
 */

/** The path of formancy.ai the demo is, without its last slash: its Worker is routed at this and everything below it. */
export const PREFIX = '/data/demo'

/**
 * How long a visitor's container keeps running once their Durable Object
 * is inactive, which is what setInactivityTimeout sets: long enough to read
 * a record without losing one's changes, short enough to free one of
 * MAX_INSTANCES. How long after the visitor's last request that ends was
 * read in Cloudflare's documentation, not measured.
 */
export const IDLE_MINUTES = 10

/**
 * How many visitors' containers run at once at most: wrangler.json's
 * max_instances, a budget and not a measurement (0070 says what ten cost).
 */
export const MAX_INSTANCES = 10

/**
 * How long a start may take before it counts as failed: from start() to the
 * server's /health answering 200. About six times the 4.8-5.3 s measured at
 * a quarter-CPU quota on 2026-10-16 (deploy/demo/Dockerfile's header), plus
 * Cloudflare's documented 1-3 s for a cold start; not measured on Cloudflare.
 */
export const START_DEADLINE_MS = 30_000

/** How often a start asks /health whether the server answers yet. */
export const POLL_MS = 250

/**
 * How long a Durable Object keeps the key of its last start once no
 * container runs: a day, after which an alarm deletes it, so nothing about a
 * visitor outlives a day.
 */
export const KEY_LIFETIME_MS = 24 * 60 * 60 * 1000

/** The most a sign-in's body may be: `{"persona":"…"}` is a few dozen bytes. */
export const SIGN_IN_BYTES = 1024
