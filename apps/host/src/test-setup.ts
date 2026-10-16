/**
 * The test environment the page needs: Angular's, as the examples page sets
 * it up, and two corrections for what runs beside the page: the server, and
 * the live demo's Worker.
 *
 * `@angular/compiler` first: the form component is compiled by the plugin,
 * but Angular's own injectables are still compiled just in time, and without
 * this every file that mounts Angular fails with "needs to be compiled using
 * the JIT compiler, but '@angular/compiler' is not available".
 */
import '@angular/compiler'
import { Buffer } from 'node:buffer'
import { webcrypto } from 'node:crypto'
import { getTestBed } from '@angular/core/testing'
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing'

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting())

/*
 * The data server runs in this worker, through the real drivers, and Vitest's
 * jsdom environment replaces the global `Uint8Array` with jsdom's realm's. A
 * driver's Buffer is Node's, so `buffer instanceof Uint8Array` is false here
 * and nowhere else: the SQL Server adapter refused every rowversion as "did
 * not come back as a rowversion", and every update on SQL Server failed.
 * Node's own constructor is put back, read off Buffer, so the check means
 * what it means in the server's process. A browser has one realm, so the page
 * loses nothing it would have.
 */
Object.defineProperty(globalThis, 'Uint8Array', { value: Object.getPrototypeOf(Buffer.prototype).constructor, configurable: true, writable: true })

/*
 * The live demo's Worker runs in this worker too, in front of the server
 * (test-demo.ts), and signs a persona's token with WebCrypto, as it does on
 * Cloudflare. jsdom's `crypto` has `getRandomValues` and no `subtle`, so
 * every sign-in failed here as a start that failed. Node's Web Crypto is
 * put back: a browser has `subtle` on a page served over HTTPS, as the
 * demo's is, and its `getRandomValues` -- the one part the page itself
 * uses, for write ids -- is the same function.
 */
Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true, writable: true })
