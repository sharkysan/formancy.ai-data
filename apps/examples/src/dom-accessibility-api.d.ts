/**
 * Types for `dom-accessibility-api`, which ships declarations it does not
 * advertise: no `types` field and no `types` condition in its `exports`, so
 * TypeScript resolves the import to `dist/index.mjs` and gives up. Declared
 * here, as formancy.ai's playground does, rather than used as `any` in the
 * one place a test compares computed names.
 *
 * Test-only: it is a devDependency and nothing ships it.
 */
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(element: Element): string
  export function computeAccessibleDescription(element: Element): string
}
