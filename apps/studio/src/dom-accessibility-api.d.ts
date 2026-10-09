/**
 * Types for `dom-accessibility-api`, which ships declarations it does not
 * advertise: no `types` field and no `types` condition in its `exports`, so
 * TypeScript resolves the import to `dist/index.mjs` and gives up. Declared
 * here, as formancy.ai's playground does, rather than used as `any` where
 * the suite reads the accessibility tree.
 *
 * Test-only: it is a devDependency and nothing ships it.
 */
declare module 'dom-accessibility-api' {
  export function computeAccessibleName(element: Element): string
  export function computeAccessibleDescription(element: Element): string
  /** The element's ARIA role, explicit or implicit, or `null` when ARIA gives it none. */
  export function getRole(element: Element): string | null
  /** Whether ARIA excludes `element` from the accessibility tree: `hidden`, `display: none`, `aria-hidden`. */
  export function isInaccessible(element: Element): boolean
}
