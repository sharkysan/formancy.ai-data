import { createFormEngine } from '@formancy/core'
import type { FormEngine } from '@formancy/core'
import type { FormSchema } from '@formancy/spec'

export type Renderer = 'react' | 'angular'

/**
 * One engine per renderer per form, each with its own id namespace.
 *
 * Not one shared engine, and not an oversight. Element ids are minted from the
 * form id, so two renderers of one document on one page would emit every id
 * twice, and `<label for>` resolves to the first match -- the second
 * renderer's fields would lose their names (formancy.ai 0095). The cost is that
 * the two previews hold their own answers; the claim shown is that one
 * document behaves the same under both, which is tested by filling each.
 *
 * The clock is the browser's. The generated documents carry logic rules, and
 * the engine never reads an ambient clock, so a host supplies one.
 */
export function previewEngine(form: FormSchema, renderer: Renderer): FormEngine {
  return createFormEngine({
    schema: form,
    formId: `${form.id}-${renderer}`,
    capabilities: {
      now: () => Date.now(),
      today: () => new Date().toISOString().slice(0, 10),
      random: () => Math.random(),
    },
  })
}
