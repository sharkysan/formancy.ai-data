import { DATABASE_KINDS, TESTED_SERVERS } from '@formancy/data-core'
import { describe, expect, test } from 'vitest'
import { DEFAULT_IMAGES, imageMajor, IMAGES_VARIABLE, MATRIX_IMAGES, selectedImage, selectedImages } from './images.js'

/**
 * The images the adapter suites run on (0067), and how a run is told which:
 * pure, over the constants and an environment this file writes. That every
 * starter follows the choice is the fixture-load test's, against real
 * servers; that CI runs a leg per image is scripts/ci-test-jobs.test.mjs's.
 */
const env = (value: string | undefined): NodeJS.ProcessEnv => (value === undefined ? {} : { [IMAGES_VARIABLE]: value })

describe('the matrix', () => {
  // The default is the image every suite runs without the variable, the one
  // compose, the snapshots and the release report's default rule read. A
  // matrix led by another image would put a leg's image where the default's
  // test job is, and a list missing the default would have no leg for it.
  test('leads each engine with its default, and names each image once', () => {
    expect(Object.keys(MATRIX_IMAGES).sort()).toEqual([...DATABASE_KINDS].sort())
    for (const kind of DATABASE_KINDS) {
      expect(MATRIX_IMAGES[kind][0], kind).toBe(DEFAULT_IMAGES[kind])
      expect(new Set(MATRIX_IMAGES[kind]).size, kind).toBe(MATRIX_IMAGES[kind].length)
    }
  })

  // An image in two engines' lists would be chosen for whichever is read
  // first, and its leg would start the other engine's default.
  test('gives no image to two engines', () => {
    const all = DATABASE_KINDS.flatMap((kind) => MATRIX_IMAGES[kind])
    expect(new Set(all).size).toBe(all.length)
  })

  // data-core says which servers the release was tested on (0068) and
  // cannot read this package, which is test support. The two lists are held
  // to each other here, both ways, so a matrix image added without its
  // major -- every leg green, and the release calling its server untested
  // -- or a major kept after its image left -- a server called tested that
  // no leg ran -- fails `pnpm test`, without waiting for a CI run.
  test('names, image by image, exactly the majors TESTED_SERVERS calls tested', () => {
    for (const kind of DATABASE_KINDS) {
      const majors = [...new Set(MATRIX_IMAGES[kind].map((image) => imageMajor(kind, image)))].sort((a, b) => a - b)
      expect([...TESTED_SERVERS[kind].majors], kind).toEqual(majors)
    }
  })
})

describe('the major an image names', () => {
  // The major a leg's server is held to (each adapter's
  // server.integration.test.ts): PostgreSQL's tag names it, SQL Server's
  // the year it is sold as, which is not the major it answers -- 2019 is 15.
  // Read as the year, the 2019 leg would expect a major 2019 and fail.
  test('reads PostgreSQL’s from its tag, and SQL Server’s from its year', () => {
    expect(imageMajor('postgres', 'postgres:16-alpine')).toBe(16)
    expect(imageMajor('postgres', 'postgres:14-alpine')).toBe(14)
    expect(imageMajor('sqlserver', 'mcr.microsoft.com/mssql/server:2019-latest')).toBe(15)
    expect(imageMajor('sqlserver', 'mcr.microsoft.com/mssql/server:2025-latest')).toBe(17)
    expect(imageMajor('sqlserver', 'mcr.microsoft.com/mssql/server:2017-latest')).toBe(14)
  })

  // A tag without a major -- `latest`, a digest -- or a year no release
  // has would otherwise hold a leg to NaN, which no server answers, and
  // fail far from the cause; an image of the other engine names neither.
  test('refuses a tag that names no major of its engine', () => {
    expect(() => imageMajor('postgres', 'postgres:latest')).toThrow('postgres:latest names no postgres major in its tag')
    expect(() => imageMajor('sqlserver', 'mcr.microsoft.com/mssql/server:2030-latest')).toThrow('mcr.microsoft.com/mssql/server:2030-latest names no sqlserver major in its tag')
    expect(() => imageMajor('sqlserver', 'postgres:17-alpine')).toThrow(/names no sqlserver major/)
  })
})

describe(`${IMAGES_VARIABLE}`, () => {
  // Unset, every suite runs the default, as it did before the matrix.
  test('unset, chooses each engine’s default', () => {
    expect(selectedImages(env(undefined))).toEqual(DEFAULT_IMAGES)
    expect(selectedImage('postgres', env(undefined))).toBe(DEFAULT_IMAGES.postgres)
  })

  // A leg names one image; the engine it does not name stays on its default,
  // as data-fixtures' PostgreSQL legs start SQL Server's default beside it.
  test('chooses the image it names for that engine, and the default for the other', () => {
    const [, older] = MATRIX_IMAGES.postgres
    expect(selectedImage('postgres', env(older))).toBe(older)
    expect(selectedImage('sqlserver', env(older))).toBe(DEFAULT_IMAGES.sqlserver)
    const [, sqlserver] = MATRIX_IMAGES.sqlserver
    expect(selectedImages(env(` ${String(older)} , ${String(sqlserver)} `))).toEqual({ postgres: older, sqlserver })
  })

  // A misspelt image -- `postgres:16` for `postgres:16-alpine` -- or one the
  // matrix does not list would otherwise run the default under the name the
  // leg was given, and report 17 as 16. Refused, with the variable and the
  // list a person picks from.
  test('refuses an image outside the matrix, naming the variable and the matrix', () => {
    expect(() => selectedImage('postgres', env('postgres:16'))).toThrow(
      `${IMAGES_VARIABLE} names postgres:16, which is no image of the matrix: postgres ${MATRIX_IMAGES.postgres.join(', ')}; sqlserver ${MATRIX_IMAGES.sqlserver.join(', ')}`,
    )
    // Refused whichever engine is asked for: a typo for one engine is a run
    // nobody chose, even of the engine the typo does not name.
    expect(() => selectedImage('sqlserver', env('postgres:16'))).toThrow(/names postgres:16, which is no image of the matrix/)
  })

  // A run is one image per engine; two would leave which one the suites
  // started to the order the list was written in.
  test('refuses two images for one engine, and one image twice', () => {
    const [first, second] = MATRIX_IMAGES.postgres
    expect(() => selectedImages(env(`${String(first)},${String(second)}`))).toThrow(`${IMAGES_VARIABLE} names two postgres images, ${String(first)} and ${String(second)}: a run is one image per engine`)
    expect(() => selectedImages(env(`${String(second)},${String(second)}`))).toThrow(`${IMAGES_VARIABLE} names two postgres images, ${String(second)} and ${String(second)}: a run is one image per engine`)
  })

  // Set and empty is a matrix value that did not arrive -- a CI leg whose
  // `${{ matrix.image }}` names a field the matrix lacks -- and would
  // otherwise run the defaults under that leg's name.
  test('refuses being set to no image', () => {
    expect(() => selectedImages(env(''))).toThrow(`${IMAGES_VARIABLE} is set and names no image: unset it for the defaults, or name one image per engine from the matrix`)
    expect(() => selectedImages(env(' , '))).toThrow(/is set and names no image/)
  })
})
