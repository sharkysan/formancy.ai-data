/**
 * The Angular half of this app needs a test environment, as formancy.ai's
 * playground does.
 *
 * `@angular/compiler` first: the preview component is compiled by the plugin,
 * but Angular's own injectables are still compiled just in time, and without
 * this every file that mounts Angular fails with "needs to be compiled using
 * the JIT compiler, but '@angular/compiler' is not available".
 */
import '@angular/compiler'
import { getTestBed } from '@angular/core/testing'
import { BrowserTestingModule, platformBrowserTesting } from '@angular/platform-browser/testing'

getTestBed().initTestEnvironment(BrowserTestingModule, platformBrowserTesting())
