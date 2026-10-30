import type { DatabaseKind } from '@formancy/data-core'
import { DATABASE_KINDS, SQLSERVER_RELEASES } from '@formancy/data-core'

/*
 * The images the suites start, and how a run is told which (0067).
 *
 * Each engine has a default, the image every suite runs unless told
 * otherwise, which compose, the committed snapshots and the release report's
 * default rule read; and a matrix, the default first, on each image of which
 * CI runs data-fixtures and that engine's adapter suite. The supported matrix
 * is MATRIX_IMAGES: an image a single file names for a fact of its own is
 * what that file showed, not a version the release was tested on (0067
 * narrows 0003). Passing on one image says nothing of another.
 *
 * FORMANCY_IMAGES chooses, as FORMANCY_BROWSERS chooses browsers (0058):
 * unset, every engine's default; set, at most one image per engine, each from
 * the matrix, and the default for an engine it does not name. Anything else
 * is refused with the variable and the list, so a typo never runs the default
 * under another image's name. turbo hashes it for `test` and `test:coverage`
 * (turbo.json), so a cached run on one image is never replayed for another.
 */

export const POSTGRES_IMAGE = 'postgres:17-alpine'
export const SQLSERVER_IMAGE = 'mcr.microsoft.com/mssql/server:2022-latest'

/**
 * The image each engine's tests run on unless the run or a file names
 * another. A record, so a third engine without an image is a compile error
 * here.
 */
export const DEFAULT_IMAGES: Readonly<Record<DatabaseKind, string>> = { postgres: POSTGRES_IMAGE, sqlserver: SQLSERVER_IMAGE }

/**
 * Every image the adapter suites and this package's run on, per engine, the
 * default first and the rest in the order CI lists their legs. Moving tags,
 * as the defaults are (0035): two runs of one commit may meet two builds,
 * and each run's report names the build it met.
 */
export const MATRIX_IMAGES: Readonly<Record<DatabaseKind, readonly string[]>> = {
  postgres: [POSTGRES_IMAGE, 'postgres:15-alpine', 'postgres:16-alpine', 'postgres:18-alpine'],
  sqlserver: [SQLSERVER_IMAGE, 'mcr.microsoft.com/mssql/server:2019-latest', 'mcr.microsoft.com/mssql/server:2025-latest'],
}

/** The variable a run is told its images by, which turbo.json hashes for the suites. */
export const IMAGES_VARIABLE = 'FORMANCY_IMAGES'

/** The matrix as a sentence: each engine and its images, the default first. */
const listed = (): string => DATABASE_KINDS.map((kind) => `${kind} ${MATRIX_IMAGES[kind].join(', ')}`).join('; ')

/**
 * The image of each engine that FORMANCY_IMAGES in `env` chooses. Throws,
 * with the sentence a person acts on, for an image no engine's matrix lists,
 * two images of one engine, and the variable set to no image at all.
 */
export function selectedImages(env: NodeJS.ProcessEnv = process.env): Record<DatabaseKind, string> {
  const value = env[IMAGES_VARIABLE]
  const chosen: Record<DatabaseKind, string> = { ...DEFAULT_IMAGES }
  if (value === undefined) return chosen
  const named = value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '')
  if (named.length === 0)
    throw new Error(`${IMAGES_VARIABLE} is set and names no image: unset it for the defaults, or name one image per engine from the matrix`)
  const seen = new Map<DatabaseKind, string>()
  for (const image of named) {
    const kind = DATABASE_KINDS.find((candidate) => MATRIX_IMAGES[candidate].includes(image))
    if (kind === undefined) throw new Error(`${IMAGES_VARIABLE} names ${image}, which is no image of the matrix: ${listed()}`)
    const before = seen.get(kind)
    if (before !== undefined) throw new Error(`${IMAGES_VARIABLE} names two ${kind} images, ${before} and ${image}: a run is one image per engine`)
    seen.set(kind, image)
    chosen[kind] = image
  }
  return chosen
}

/** The image of `kind` a start without an image of its own runs: the one FORMANCY_IMAGES chooses, or the default. */
export function selectedImage(kind: DatabaseKind, env: NodeJS.ProcessEnv = process.env): string {
  return selectedImages(env)[kind]
}

/**
 * The major the server of `image` answers, read from its tag: PostgreSQL's
 * names it (`16-alpine`), SQL Server's the year it is sold as
 * (`2019-latest`), which data-core's SQLSERVER_RELEASES turns into the major
 * it answers (15). Throws for a tag that names neither. What a tag says is
 * a moving tag's promise (0035); each adapter's server.integration.test.ts
 * holds the server a leg started to it, so a tag that moved to another major
 * fails there, and images.test.ts holds data-core's TESTED_SERVERS to it.
 */
export function imageMajor(kind: DatabaseKind, image: string): number {
  switch (kind) {
    case 'postgres': {
      const major = /^postgres:(\d+)(?:[.-]|$)/.exec(image)?.[1]
      if (major !== undefined) return Number(major)
      break
    }
    case 'sqlserver': {
      const year = /^mcr\.microsoft\.com\/mssql\/server:(\d{4})-/.exec(image)?.[1]
      const major = Object.entries(SQLSERVER_RELEASES).find(([, release]) => String(release) === year)?.[0]
      if (major !== undefined) return Number(major)
      break
    }
  }
  throw new Error(`${image} names no ${kind} major in its tag`)
}
