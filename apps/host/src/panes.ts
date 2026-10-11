import type { RendererChoice } from './prefs.js'
import type { Renderer } from './session.js'

/** The renderers a choice draws, in the page's order: React first. */
export function renderersOf(choice: RendererChoice): Renderer[] {
  return choice === 'both' ? ['react', 'angular'] : [choice]
}

/** How the renderer switch names each choice. */
export const CHOICES = [
  { value: 'react', label: 'React' },
  { value: 'angular', label: 'Angular' },
  { value: 'both', label: 'Both' },
] as const satisfies ReadonlyArray<{ value: RendererChoice; label: string }>
