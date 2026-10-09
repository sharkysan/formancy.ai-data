/**
 * The test environment the page needs: Angular's, as the examples page sets
 * it up, and one correction for the server that runs beside the page.
 *
 * `@angular/compiler` first: the form component is compiled by the plugin,
 * but Angular's own injectables are still compiled just in time, and without
 * this every file that mounts Angular fails with "needs to be compiled using
 * the JIT compiler, but '@angular/compiler' is not available".
 */
import '@angular/compiler'
import { Buffer } from 'node:buffer'
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
