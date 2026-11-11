import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { admitted, deployRefusing, floorRefusals, productionClosure, satisfies, stageNodes } from './node-floor.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('the Node versions this repository names (0148)', () => {
  // The workspace's floor said 22.12.0 while Angular 22 and jsdom's selector
  // engine asked for 22.22, and undici 8.12 stopped the suites on 22.14; and
  // a floor of `>=22.22.3` still admits Node 23, 24.0 and 25, which those
  // refuse. Every release the floor admits is one a contributor may install
  // on (watched failing with the floor `>=22.22.3`: 57 packages refusing
  // 23.0.0, 29 refusing 24.0.0 and 15 refusing 25.0.0; and with `>=22.12.0`).
  test("the workspace's floor admits only Nodes every package the lockfile installs accepts", () => {
    expect(floorRefusals(JSON.parse(read('package.json')).engines.node, read('pnpm-lock.yaml'))).toEqual([])
  })

  // The image runs what a production deploy of the server installs, on the
  // Node its last stage names; a dependency that moves its floor past that
  // Node is caught here, not in a container that will not start (watched
  // failing with the runtime stage built FROM node:20-alpine: tedious and
  // the @azure packages named).
  test("the server image's runtime Node is one every package it deploys accepts", () => {
    const runtime = stageNodes(read('packages/data-server/Dockerfile')).at(-1).node
    expect(deployRefusing(runtime, read('pnpm-lock.yaml'), 'packages/data-server')).toEqual([])
  })
})

describe('satisfies', () => {
  // The forms the lockfile's engines fields use. A reader that took `^22.22.3`
  // for `>=22.22.3` would let a floor of 23 pass a package that refuses it
  // (watched failing with the caret read as >=: 23.0.0 accepted).
  test('reads alternatives, carets and their ceilings', () => {
    const range = '^22.22.3 || ^24.15.0 || >=26.0.0'
    expect(satisfies('22.22.2', range)).toBe(false)
    expect(satisfies('22.22.3', range)).toBe(true)
    expect(satisfies('23.0.0', range)).toBe(false)
    expect(satisfies('24.15.0', range)).toBe(true)
    expect(satisfies('26.1.0', range)).toBe(true)
  })

  // A bare major is that major's every release, and a space after an
  // operator is still the operator's (watched failing with a bare major read
  // as its .0.0 alone: 20.5.0 refused by `18 || 20 || >=22`).
  test('reads bare majors, x-ranges and spaced operators', () => {
    expect(satisfies('20.5.0', '18 || 20 || >=22')).toBe(true)
    expect(satisfies('21.0.0', '18 || 20 || >=22')).toBe(false)
    expect(satisfies('22.12.0', '>= 10')).toBe(true)
    expect(satisfies('22.12.0', '6.* || 8.* || >= 10.*')).toBe(true)
    expect(satisfies('7.0.0', '6.* || 8.* || >= 10.*')).toBe(false)
    expect(satisfies('14.17.0', '>=16 || 14 >=14.17')).toBe(true)
    expect(satisfies('14.16.0', '>=16 || 14 >=14.17')).toBe(false)
  })

  // `>1.2` is past every 1.2.x and `<=1.2` takes them all, as npm reads them.
  test('reads a part left out as every release it names', () => {
    expect(satisfies('1.2.9', '>1.2')).toBe(false)
    expect(satisfies('1.3.0', '>1.2')).toBe(true)
    expect(satisfies('1.2.9', '<=1.2')).toBe(true)
    expect(satisfies('1.3.0', '<=1.2')).toBe(false)
    expect(satisfies('0.2.5', '^0.2.3')).toBe(true)
    expect(satisfies('0.3.0', '^0.2.3')).toBe(false)
  })

  // A range it cannot read would otherwise be a package it passes unread.
  // npm keeps a release out of a pre-release's range, which a reader that
  // dropped the tag would not (watched failing with the tag dropped:
  // `22.22.3-rc.1` read as 22.22.3).
  test('throws on a range it cannot read, a pre-release among them', () => {
    expect(() => satisfies('22.12.0', 'latest')).toThrow(/not a version/u)
    expect(() => satisfies('22.22.3', '22.22.3-rc.1')).toThrow(/not a version/u)
  })
})

describe('admitted', () => {
  // What the floor promises a contributor is every major it admits, from
  // its first: a check of its lowest release alone passed `>=22.22.3`
  // while Node 24.0 was refused (watched failing with the lowest release
  // alone: [22.22.3]).
  test('takes the lowest release of each major the floor admits', () => {
    expect(admitted('^22.22.3 || ^24.15.0 || >=26.0.0', 27)).toEqual(['22.22.3', '24.15.0', '26.0.0', '27.0.0'])
    expect(admitted('>=22.22.3', 24)).toEqual(['22.22.3', '23.0.0', '24.0.0'])
  })

  // Any other form's lowest releases would be a guess.
  test('throws on a floor that is not carets and lower bounds', () => {
    expect(() => admitted('~22.22.3', 27)).toThrow(/not a floor/u)
    expect(() => admitted('22.x', 27)).toThrow(/not a floor/u)
    expect(() => admitted('^0.2.3', 27)).toThrow(/not a floor/u)
  })
})

describe('stageNodes', () => {
  // `node:22.12-alpine` floats over every 22.12 release; the oldest is the
  // one to hold. A stage built FROM another's name runs that one's Node, and
  // a flag before the image is not the image (watched failing with an
  // earlier stage's name left unread: "build names no Node").
  test("reads each stage's Node, through a flag and an earlier stage's name", () => {
    const dockerfile =
      'FROM --platform=linux/amd64 node:22.12-alpine AS build\nRUN x\nFROM build AS test\nFROM --platform=$BUILDPLATFORM node:20-alpine AS runtime\n'
    expect(stageNodes(dockerfile).map((stage) => stage.node)).toEqual(['22.12.0', '22.12.0', '20.0.0'])
    expect(stageNodes(`FROM node:24.15-alpine@sha256:${'a'.repeat(64)}\n`)[0].node).toBe('24.15.0')
  })

  // A runtime on an image it cannot read passed before as the build
  // stage's Node: tedious asks for 22 and would have run on distroless's 20
  // unread (watched failing with an unreadable stage skipped).
  test('throws on a stage built FROM an image that names no Node it can read', () => {
    expect(() => stageNodes('FROM node:22.12-alpine AS build\nFROM gcr.io/distroless/nodejs20-debian12\n')).toThrow(/names no Node/u)
    expect(() => stageNodes('ARG NODE=22.12\nFROM node:${NODE}-alpine\n')).toThrow(/names no Node/u)
    expect(() => stageNodes('FROM node:lts-alpine\n')).toThrow(/names no Node/u)
  })
})

describe('productionClosure', () => {
  const lock = `lockfileVersion: '9.0'
importers:
  packages/server:
    dependencies:
      fastify:
        specifier: ^5.0.0
        version: 5.0.0
      '@x/core':
        specifier: workspace:*
        version: link:../core
    devDependencies:
      vitest:
        specifier: ^5.0.0
        version: 5.0.0
  packages/core:
    dependencies:
      ajv:
        specifier: ^8.0.0
        version: 8.0.0(fast-uri@3.1.9)
      wide-cjs:
        specifier: npm:wide@4.2.3
        version: wide@4.2.3
packages:
  fastify@5.0.0:
    engines: {node: '>=20'}
  vitest@5.0.0:
    engines: {node: '>=24'}
  ajv@8.0.0:
    engines: {node: '>=26'}
  fast-uri@3.1.9: {}
  wide@4.2.3:
    engines: {node: '>=28'}
snapshots:
  fastify@5.0.0: {}
  vitest@5.0.0: {}
  ajv@8.0.0(fast-uri@3.1.9):
    dependencies:
      fast-uri: 3.1.9
  fast-uri@3.1.9: {}
  wide@4.2.3: {}
`

  // What the image holds is what a production deploy installs: a
  // devDependency is not in it, and a workspace project it links is, with
  // that project's own dependencies, an alias read as the package it stands
  // for (watched failing with devDependencies followed: vitest named; with
  // links skipped: ajv missing; and with an alias read as a version: no
  // snapshot of wide-cjs@wide@4.2.3).
  test('follows dependencies, workspace links and aliases, never a devDependency', () => {
    expect([...productionClosure(lock, 'packages/server').installed].sort()).toEqual([
      'ajv@8.0.0(fast-uri@3.1.9)',
      'fast-uri@3.1.9',
      'fastify@5.0.0',
      'wide@4.2.3',
    ])
    expect(deployRefusing('22.12.0', lock, 'packages/server')).toEqual([
      { name: 'wide@4.2.3', range: '>=28' },
      { name: 'ajv@8.0.0', range: '>=26' },
    ])
  })

  // An entry the lockfile does not hold would have been a subtree left out
  // and passed unread (watched failing with a missing snapshot read as one
  // with no dependencies).
  test('throws on a dependency the lockfile holds no snapshot of', () => {
    expect(() => productionClosure(lock.replace('  fast-uri@3.1.9: {}\n  wide@4.2.3: {}\n', '  wide@4.2.3: {}\n'), 'packages/server')).toThrow(
      /no snapshot of fast-uri@3.1.9/u,
    )
  })
})
