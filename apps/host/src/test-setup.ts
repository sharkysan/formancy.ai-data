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
import { configure } from '@testing-library/react'

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
Object.defineProperty(globalThis, 'Uint8Array', {
  value: (Object.getPrototypeOf(Buffer.prototype) as { constructor: unknown }).constructor,
  configurable: true,
  writable: true,
})

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

/*
 * How long a `findBy` or a `waitFor` waits for the page by default: fifteen
 * seconds, the figure the files that name a wait of their own already use
 * (`ARRIVES`), and the studio's suite's default. Testing Library's own is
 * one second. On CI's hosted runner, with every other package's suite
 * beside it, AG Grid had not drawn the Customer column's filter box after
 * 1.4 seconds and lookup-box.test.tsx failed (pull request #188's run, on
 * a change to the studio alone); the files that render AG Grid directly
 * wait for it with the default. A failing wait only takes longer to say so.
 */
configure({ asyncUtilTimeout: 15_000 })
