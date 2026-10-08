import { readFileSync } from 'node:fs'

/** The fixture files this package ships, by name. */
export type FixtureFile = 'postgres.sql' | 'postgres.restricted.sql' | 'sqlserver.sql' | 'sqlserver.restricted.sql'

/**
 * A fixture's text.
 *
 * Resolved against this module's own location, which is `src/` under test and
 * `dist/` once built. Both sit beside `fixtures/`, so one relative URL serves
 * both.
 */
export function readFixture(file: FixtureFile): string {
  return readFileSync(new URL(`../fixtures/${file}`, import.meta.url), 'utf8')
}

/**
 * T-SQL batches, split where sqlcmd would split them: at `GO` alone on a line.
 *
 * A driver sends one batch at a time and has no idea what `GO` is; sent as
 * text, it is a syntax error. Matched on the whole line, case-insensitively,
 * so a column called `go_live` or a comment mentioning go does not split a
 * statement in half.
 */
export function splitBatches(text: string): string[] {
  return text
    .replaceAll('\r\n', '\n')
    .split(/^[ \t]*go[ \t]*$/im)
    .map((batch) => batch.trim())
    .filter((batch) => batch.replaceAll(/--.*$/gm, '').trim() !== '')
}
