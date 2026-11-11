import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'vitest'
import { deployRefusing, imageNode, lowest, productionClosure, refusing, satisfies } from './node-floor.mjs'

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8')

describe('the Node versions this repository names (0148)', () => {
  // The workspace's floor said 22.12.0 while Angular 22 and jsdom's selector
  // engine asked for 22.22, and undici 8.12 stopped the suites on 22.18:
  // a floor no package refuses is one a contributor can install on
  // (watched failing with the floor put back to >=22.12.0: 58 packages
  // named, and at >=22.19.0, 13).
  test("the workspace's floor is a Node every package the lockfile installs accepts", () => {
    const floor = lowest(JSON.parse(read('package.json')).engines.node)
    expect(refusing(floor, read('pnpm-lock.yaml'))).toEqual([])
  })

  // The image runs what a production deploy of the server installs, on the
  // Node its Dockerfile names; a dependency that moves its floor past that
  // Node is caught here, not in a container that will not start (watched
  // failing with the image built FROM node:20-alpine: tedious and the
  // @azure packages named).
  test("the server image's Node is one every package it deploys accepts", () => {
    const image = imageNode(read('packages/data-server/Dockerfile'))
    expect(deployRefusing(image, read('pnpm-lock.yaml'), 'packages/data-server')).toEqual([])
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
  test('throws on a range it cannot read', () => {
    expect(() => satisfies('22.12.0', 'latest')).toThrow(/not a version/u)
  })
})

describe('lowest and imageNode', () => {
  // A caret floor would have a lowest version and a ceiling; the guard would
  // test the one and say nothing of the other.
  test('take a plain floor alone', () => {
    expect(lowest('>=22.22.3')).toBe('22.22.3')
    expect(() => lowest('^22.22.3')).toThrow(/not a plain floor/u)
  })

  // `node:22.12-alpine` floats over every 22.12 release; the oldest is the
  // one the guard must hold, and stages on two Nodes have no one answer.
  test("read the oldest release a Dockerfile's node: tag names", () => {
    expect(imageNode('FROM node:22.12-alpine AS build\nRUN x\nFROM node:22.12-alpine AS runtime\n')).toBe('22.12.0')
    expect(imageNode('FROM node:24-alpine\n')).toBe('24.0.0')
    expect(() => imageNode('FROM node:22.12-alpine\nFROM node:24.1-alpine\n')).toThrow(/different Node/u)
    expect(() => imageNode('FROM alpine:3.20\n')).toThrow(/no node: image/u)
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
packages:
  fastify@5.0.0:
    engines: {node: '>=20'}
  vitest@5.0.0:
    engines: {node: '>=24'}
  ajv@8.0.0:
    engines: {node: '>=26'}
  fast-uri@3.1.9: {}
snapshots:
  fastify@5.0.0: {}
  vitest@5.0.0: {}
  ajv@8.0.0(fast-uri@3.1.9):
    dependencies:
      fast-uri: 3.1.9
  fast-uri@3.1.9: {}
`

  // What the image holds is what a production deploy installs: a
  // devDependency is not in it, and a workspace project it links is, with
  // that project's own dependencies (watched failing with devDependencies
  // followed: vitest named; and with links skipped: ajv missing).
  test('follows dependencies and workspace links, never a devDependency', () => {
    expect([...productionClosure(lock, 'packages/server')].sort()).toEqual(['ajv@8.0.0(fast-uri@3.1.9)', 'fast-uri@3.1.9', 'fastify@5.0.0'])
    expect(deployRefusing('22.12.0', lock, 'packages/server')).toEqual([{ name: 'ajv@8.0.0', range: '>=26' }])
  })
})
