import type { Refusal } from './client.js'

/**
 * A refusal's field problems as `engine.applyServerErrors` takes them: the
 * server's sentences, grouped by field, in the order the server gave them,
 * each once. `{}` when the refusal concerns no field.
 *
 * Sentences and not codes, because the 0.3.0 renderers print an entry
 * verbatim, beside the field and in the error summary: a code would put
 * `not-an-option` in front of a person. The server promises its sentence is
 * showable and never echoes a value (0011); the code stays on the Refusal for
 * a program to read.
 */
export function fieldProblems(refusal: Refusal): Record<string, string[]> {
  const problems: Record<string, string[]> = {}
  for (const { field, message } of refusal.fieldErrors ?? []) {
    const sentences = (problems[field] ??= [])
    if (!sentences.includes(message)) sentences.push(message)
  }
  return problems
}
