import { execFileSync } from 'node:child_process'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, posix } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, test } from 'vitest'
import YAML from 'yaml'

/**
 * The architecture documentation held to the repository it describes:
 * docs/README.md, the entry, and arc42's twelve sections in
 * docs/architecture/, under the file names formancy.ai gives them.
 *
 * Prose does not break, so five ways of it quietly describing another
 * repository fail here instead. The first four are the ones
 * formancy.ai-report's and formancy.ai-health's guards hold; the fifth is
 * this repository's, because its sections name the code they describe as
 * paths in backticks rather than as links:
 *
 * - a section or the entry missing, the entry not linking every section, or
 *   a file in docs/architecture/ that is none of the twelve;
 * - a workspace package or app that the building blocks do not name, read
 *   from pnpm-workspace.yaml's globs and each manifest's `name`, so that a
 *   package is placed in section 5 by the pull request that adds it;
 * - a decision record that no section links to, so that a new record is
 *   placed in the architecture by the pull request that writes it;
 * - a relative link in the entry or a section that names no file git would
 *   commit, or a fragment that names no heading of the Markdown file it
 *   points into, as GitHub anchors headings;
 * - a repository path written in backticks that names nothing git would
 *   commit. What counts as a path is `isRepositoryPath`, tested below: a
 *   code span with no space in it, holding a slash, whose first segment is a
 *   top-level directory of the repository. A path given from inside a
 *   package, as `routes/runtime.ts` is under the server's `src/`, is not
 *   one, and nothing here checks it.
 *
 * Everything is read from the files: the manifests, the directory listings,
 * what git would commit, the links and code spans as Markdown writes them.
 * Nothing here matches a phrase of the prose. What none of it can see is
 * review's: whether a sentence is still true of what it links or names, and
 * whether a package is described where it is named. Headings are read as
 * `#` headings; an underlined heading's anchor is not seen, so a link to
 * one is refused, which is the safe side.
 *
 * Each rule was watched failing with its defect planted in the real files --
 * a section deleted, a package's name removed from the building blocks, a
 * record's last citation dropped, a link and a fragment broken, a path
 * misspelled -- and put back.
 */
const repo = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The entry: who reads what, the sections, the decisions and the other documents. */
const ENTRY = 'docs/README.md'

const ARCHITECTURE = 'docs/architecture'

/** arc42's twelve sections, by the names formancy.ai's docs/architecture/ gives them. */
const SECTIONS = [
  '01-introduction-and-goals.md',
  '02-constraints.md',
  '03-context-and-scope.md',
  '04-solution-strategy.md',
  '05-building-blocks.md',
  '06-runtime-view.md',
  '07-deployment-view.md',
  '08-crosscutting-concepts.md',
  '09-quality-requirements.md',
  '10-verification.md',
  '11-risks-and-debt.md',
  '12-glossary.md',
]

const BUILDING_BLOCKS = `${ARCHITECTURE}/05-building-blocks.md`

const DECISIONS = 'docs/decisions'

/** A decision record's file name: its number, then its title. */
const RECORD = /^\d{4}-.+\.md$/

/** A file's text, line endings as Markdown reads them, or undefined when there is none. */
function textOf(file) {
  try {
    return readFileSync(join(repo, file), 'utf8').replaceAll('\r\n', '\n')
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return undefined
    throw error
  }
}

/** A directory's entries, or none when it is not there. */
function listing(directory) {
  try {
    return readdirSync(join(repo, directory), { withFileTypes: true })
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

/** `git ls-files -z` with `options`, as `/`-separated paths. */
const gitFiles = (...options) =>
  execFileSync('git', ['ls-files', '-z', ...options], { cwd: repo, encoding: 'utf8' })
    .split('\0')
    .filter((file) => file !== '')

/**
 * Every file git would commit, `/`-separated: tracked, and new but not
 * ignored, less a tracked file deleted from the checkout, which the next
 * commit would not hold either.
 */
function committable() {
  const deleted = new Set(gitFiles('--deleted'))
  return new Set(gitFiles('--cached', '--others', '--exclude-standard').filter((file) => !deleted.has(file)))
}

/**
 * Every workspace package and app, as `{ file, name }`: the directories
 * pnpm-workspace.yaml names, each `<directory>/*` or a directory, and the
 * `name` each one's manifest gives. The root is the workspace, not one of
 * its packages. Another pattern throws rather than being read as matching
 * nothing.
 */
function workspacePackages() {
  const workspace = YAML.parse(textOf('pnpm-workspace.yaml') ?? '') ?? {}
  const directories = []
  for (const pattern of workspace.packages ?? []) {
    const each = /^([\w.-]+(?:\/[\w.-]+)*)\/\*$/.exec(pattern)
    if (each === null && !/^[\w.-]+(?:\/[\w.-]+)*$/.test(pattern)) {
      throw new Error(`pnpm-workspace.yaml: ${pattern} is not <directory>/* or a directory, which is all this guard reads; teach it`)
    }
    if (each === null) directories.push(pattern)
    else for (const entry of listing(each[1])) if (entry.isDirectory()) directories.push(`${each[1]}/${entry.name}`)
  }
  return directories.flatMap((directory) => {
    const text = textOf(`${directory}/package.json`)
    return text === undefined ? [] : [{ file: `${directory}/package.json`, name: String(JSON.parse(text).name ?? '') }]
  })
}

/** Every decision record's path, from the directory listing. */
const decisionRecords = () => listing(DECISIONS).filter((entry) => entry.isFile() && RECORD.test(entry.name)).map((entry) => `${DECISIONS}/${entry.name}`)

/** Whether `text` names `name` whole: not as a part of a longer name. */
function names(text, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')
  return new RegExp(`(?<![\\w@./-])${escaped}(?![\\w/-]|\\.\\w)`).test(text)
}

/** `markdown` with every fenced block's lines blanked, so nothing inside one is read as a heading, a link or a path. */
function outsideFences(markdown) {
  let fence
  return markdown
    .split('\n')
    .map((line) => {
      const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)
      if (fence === undefined) {
        if (marker === null) return line
        fence = marker[1]
        return ''
      }
      if (marker !== null && marker[1][0] === fence[0] && marker[1].length >= fence.length && line.trim() === marker[1]) fence = undefined
      return ''
    })
    .join('\n')
}

/** A code span: a run of backticks, text that holds no blank line, and the same run closing it. */
const CODE_SPAN = /(`+)((?:(?!\n[ \t]*\n)[\s\S])*?[^`])\1(?!`)/g

/** Inline code turned to letters, line breaks kept: a bracket inside a code span is no link, and a link around one is still a link. */
const lettered = (text) => text.replace(CODE_SPAN, (span) => span.replace(/[^\n]/g, 'x'))

/** An inline link or image: its text, which may wrap and hold one level of brackets, and its destination, with an optional title. */
const LINK = /!?\[((?:[^[\]]|\[[^[\]]*\])*)\]\(\s*(<[^<>\n]*>|[^\s()<>]*(?:\([^\s()]*\)[^\s()<>]*)*)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g

/** A link reference definition: `[label]: destination`. */
const DEFINITION = /^ {0,3}\[[^\]\n]+\]:[ \t]*(<[^<>\n]*>|\S+)/gm

/** Every link `markdown` writes, inline or by definition, by its destination as written. */
function linksIn(markdown) {
  const text = lettered(outsideFences(markdown))
  return [...text.matchAll(LINK), ...text.matchAll(DEFINITION)].map((found) => found.at(-1).replace(/^<(.*)>$/, '$1'))
}

/** Whether a destination is relative: no scheme, and not `//host`. */
const isRelative = (href) => !/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith('//')

/**
 * The anchor GitHub gives a heading's text: a link read as its text, code as
 * its letters, lowercased, everything but letters, marks, digits, `_`, `-`
 * and spaces dropped, and each space a hyphen.
 */
const slug = (text) =>
  text
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc}\- ]/gu, '')
    .replace(/ /g, '-')

/** The anchors of a Markdown file's `#` headings, a repeated one with -1, -2 after it, as GitHub numbers them. */
function anchorsOf(markdown) {
  const seen = new Map()
  const anchors = new Set()
  for (const line of outsideFences(markdown).split('\n')) {
    const heading = /^ {0,3}#{1,6}(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line)
    if (heading === null) continue
    const base = slug(heading[1] ?? '')
    const count = seen.get(base) ?? 0
    seen.set(base, count + 1)
    anchors.add(count === 0 ? base : `${base}-${String(count)}`)
  }
  return anchors
}

/**
 * Where a relative link in `file` leads: `{ target, fragment }`, the target a
 * `/`-separated path from the repository's root -- `file` itself for a bare
 * fragment -- or `{ outside: true }` past the root.
 */
function resolveLink(file, href) {
  const at = href.indexOf('#')
  const path = decodeURIComponent(at === -1 ? href : href.slice(0, at))
  const fragment = at === -1 ? undefined : decodeURIComponent(href.slice(at + 1))
  const target = path === '' ? file : posix.normalize(posix.join(posix.dirname(file), path)).replace(/\/$/, '')
  return target === '..' || target.startsWith('../') ? { outside: true } : { target, fragment }
}

/**
 * What is wrong with `file`'s relative links, one sentence each: a target
 * past the root, one git would not commit -- a directory, an ignored file,
 * none at all -- a fragment into a file that is not Markdown, and one that
 * names no heading. `files` is what git would commit, and `read` a file's
 * text, so that a fixture can stand in for the repository.
 */
function linkProblems(file, markdown, files, read) {
  return linksIn(markdown)
    .filter(isRelative)
    .flatMap((href) => {
      const link = resolveLink(file, href)
      if (link.outside) return [`${file}: ${href} leads out of the repository`]
      if (!files.has(link.target)) {
        const directory = [...files].some((path) => path.startsWith(`${link.target}/`))
        return [`${file}: ${href} names ${link.target}, ${directory ? 'a directory: link its README.md' : 'which is no file git would commit'}`]
      }
      if (link.fragment === undefined || link.fragment === '') return []
      if (!link.target.endsWith('.md')) return [`${file}: ${href} has a fragment into a file that is not Markdown, which nothing here can check`]
      return anchorsOf(read(link.target) ?? '').has(link.fragment) ? [] : [`${file}: ${href} names no heading of ${link.target}`]
    })
}

/** The text of every code span `markdown` writes outside a fence, a single space either side taken off as CommonMark does. */
function codeSpansIn(markdown) {
  return [...outsideFences(markdown).matchAll(CODE_SPAN)].map((found) => {
    const text = found[2].replace(/\n/g, ' ')
    return /^ .*[^ ].* $/.test(text) ? text.slice(1, -1) : text
  })
}

/** The repository's top-level directories: the first segment of every file git would commit below one. */
const topLevelDirectories = (files) => new Set([...files].filter((file) => file.includes('/')).map((file) => file.slice(0, file.indexOf('/'))))

/**
 * Whether a code span is a repository path, the rule this guard holds the
 * sections' backticks to: no whitespace, a slash, and a first segment that
 * is one of the repository's top-level directories. `packages/data-core/`,
 * `.github/workflows/gates.yml` and `apps/*\/scripts/browser-test.mjs` are;
 * `routes/runtime.ts`, `@formancy/data-core`, `<root>/<id>/<version>.json`,
 * `env:NAME` and `/v1/forms` are not.
 */
function isRepositoryPath(span, tops) {
  if (/\s/.test(span) || !span.includes('/')) return false
  return tops.has(span.slice(0, span.indexOf('/')))
}

/** Characters that make a path a pattern: a wildcard, or a choice in braces. */
const GLOB = /[*?{]/

/** A path with each choice in braces spelled out: `a/{b,c}.ts` is `a/b.ts` and `a/c.ts`. */
function expansions(path) {
  const open = path.indexOf('{')
  if (open === -1) return [path]
  const close = path.indexOf('}', open)
  if (close === -1) throw new Error(`${path}: a brace that does not close`)
  return path
    .slice(open + 1, close)
    .split(',')
    .flatMap((choice) => expansions(`${path.slice(0, open)}${choice}${path.slice(close + 1)}`))
}

/**
 * A wildcard pattern as a regular expression over `/`-separated paths: `**`
 * any number of segments, `*` and `?` within one. It matches a path or
 * anything below one, so `apps/*` matches the apps' directories.
 */
function globPattern(pattern) {
  let source = ''
  for (let at = 0; at < pattern.length; at += 1) {
    if (pattern.startsWith('**/', at)) {
      source += '(?:[^/]+/)*'
      at += 2
    } else if (pattern.startsWith('**', at)) {
      source += '.*'
      at += 1
    } else if (pattern[at] === '*') source += '[^/]*'
    else if (pattern[at] === '?') source += '[^/]'
    else source += pattern[at].replace(/[.+^$()|[\]{}\\]/g, '\\$&')
  }
  return new RegExp(`^${source}(?:/.*)?$`)
}

/** Whether `path`, a choice already spelled out, names a file git would commit, a directory holding one, or a pattern matching one. */
function existsAs(path, files) {
  const bare = path.replace(/\/$/, '')
  if (/[*?]/.test(bare)) {
    const pattern = globPattern(bare)
    return [...files].some((candidate) => pattern.test(candidate))
  }
  return files.has(bare) || [...files].some((candidate) => candidate.startsWith(`${bare}/`))
}

/**
 * What is wrong with the repository paths in `file`'s code spans, one
 * sentence each: a path that is no file git would commit and no directory
 * holding one, a pattern that matches neither, and a choice in braces of
 * which one does not. `files` is what git would commit, so that a fixture
 * can stand in for the repository.
 */
function pathProblems(file, markdown, files) {
  const tops = topLevelDirectories(files)
  const paths = [...new Set(codeSpansIn(markdown).filter((span) => isRepositoryPath(span, tops)))]
  return paths.flatMap((path) => {
    const missing = expansions(path).filter((each) => !existsAs(each, files))
    if (missing.length === 0) return []
    const as = missing[0] === path ? '' : ` as ${missing.map((each) => `\`${each}\``).join(', ')}`
    return [`${file}: \`${path}\` ${/[*?]/.test(path) ? 'matches' : 'names'} nothing git would commit${as}`]
  })
}

/** The entry and every Markdown file in docs/architecture/, by path. */
const documents = () => [ENTRY, ...listing(ARCHITECTURE).filter((entry) => entry.isFile() && entry.name.endsWith('.md')).map((entry) => `${ARCHITECTURE}/${entry.name}`)]

describe('the architecture', () => {
  // A reader told the architecture is arc42 looks for a section by its
  // number. One missing, renamed, or never linked from the entry is a
  // section nobody finds; a thirteenth file is a section arc42 does not
  // have, and the place one subject quietly goes.
  test("is the entry and arc42's twelve sections, each linked from the entry, and nothing else", () => {
    const missing = [ENTRY, ...SECTIONS.map((name) => `${ARCHITECTURE}/${name}`)].filter((file) => textOf(file) === undefined)
    expect(missing, 'write these; formancy.ai docs/architecture/ has the shape').toEqual([])
    const linked = new Set(linksIn(textOf(ENTRY)).filter(isRelative).map((href) => resolveLink(ENTRY, href).target))
    expect(SECTIONS.filter((name) => !linked.has(`${ARCHITECTURE}/${name}`)), `${ENTRY} does not link these`).toEqual([])
    const extra = listing(ARCHITECTURE).map((entry) => entry.name).filter((name) => !SECTIONS.includes(name))
    expect(extra, 'not one of arc42 twelve: fold it into the section it belongs to').toEqual([])
  })

  // A package added to the workspace and not to the building blocks leaves
  // section 5 drawing a repository with one package fewer, and nothing in
  // the package's own pull request would notice.
  test('names every workspace package and app in the building blocks', () => {
    const text = textOf(BUILDING_BLOCKS) ?? ''
    const absent = workspacePackages()
      .filter(({ name }) => !names(text, name))
      .map(({ file, name }) => `${name} (${file})`)
    expect(absent, `${BUILDING_BLOCKS} must name each, and say what it may import`).toEqual([])
  })

  // A decision changes what the architecture says. One cited nowhere in it
  // is a decision the sections were not edited for, and the record the
  // reader of a section would need is the one it does not point to.
  test('links every decision record from a section', () => {
    const cited = new Set(
      documents()
        .filter((file) => file !== ENTRY)
        .flatMap((file) => linksIn(textOf(file) ?? '').filter(isRelative).map((href) => resolveLink(file, href).target)),
    )
    expect(decisionRecords().filter((record) => !cited.has(record)), 'place each in the section it changes, by a link to its file').toEqual([])
  })

  // A link to a file that moved, to one git ignores -- the plan, a build --
  // or to a heading since reworded opens on nothing, or on GitHub's 404,
  // and reads as true in the source.
  test('links only to files git would commit, and to headings they have', () => {
    const files = committable()
    expect(documents().flatMap((file) => linkProblems(file, textOf(file) ?? '', files, textOf))).toEqual([])
  })

  // The sections name the module a step happens in, by its path, far more
  // often than they link it. A file renamed or deleted leaves that path
  // pointing at nothing, and the sentence around it reads as true.
  test('names in backticks only repository paths git would commit', () => {
    const files = committable()
    expect(documents().flatMap((file) => pathProblems(file, textOf(file) ?? '', files))).toEqual([])
  })

  // A guard on the guard: each check above is about absence, so a walk that
  // read nothing -- no manifest found, no record listed, no link parsed, no
  // path recognised -- would pass them forever. What the files hold today.
  test('reads the workspace, the records, the links and the paths at all', () => {
    const packages = workspacePackages().map(({ name }) => name)
    expect(packages).toEqual(expect.arrayContaining(['@formancy/data-core', '@formancy/data-postgres', '@formancy/data-sqlserver', '@formancy/data-server', '@formancy/data-studio', '@formancy/data-host']))
    expect(packages).not.toContain('formancy-data')
    expect(decisionRecords()).toContain(`${DECISIONS}/0001-a-paid-module-in-its-own-repository.md`)
    expect(decisionRecords()).not.toContain(`${DECISIONS}/README.md`)
    const links = documents().flatMap((file) =>
      linksIn(textOf(file) ?? '')
        .filter(isRelative)
        .map((href) => resolveLink(file, href))
        .filter((link) => link.outside !== true),
    )
    expect(links.filter((link) => link.target.endsWith('.md') && (link.fragment ?? '') !== ''), 'no anchor into Markdown was checked').not.toEqual([])
    expect(links.map((link) => link.target).filter((target) => target.startsWith(`${DECISIONS}/`))).not.toEqual([])
    const files = committable()
    const tops = topLevelDirectories(files)
    expect([...tops]).toEqual(expect.arrayContaining(['.github', 'apps', 'deploy', 'docs', 'packages', 'scripts']))
    const paths = documents().flatMap((file) => codeSpansIn(textOf(file) ?? '').filter((span) => isRepositoryPath(span, tops)))
    expect(paths).toContain('packages/data-core/src/records/plan.ts')
    expect(paths.filter((path) => GLOB.test(path)), 'no pattern was checked').not.toEqual([])
  })
})

describe('the Markdown reader', () => {
  // Links are read as Markdown writes them. Wrapped text, an image, a title
  // and a definition are each a link GitHub follows; a link shown in a code
  // block or a code span is an example, and checking it would refuse the
  // documentation of a link.
  test('finds every link GitHub follows, and none inside code', () => {
    const markdown = [
      'See [a](one.md), ![b](two.png "a title") and [a link that\nwraps](three.md#part).',
      'Not `[c](four.md)`, and [`code` in its text](five.md).',
      '```text',
      '[d](six.md)',
      '```',
      '[e]: <seven.md>',
      '[f](https://example.org/x) and [g](#local).',
    ].join('\n')
    expect(linksIn(markdown)).toEqual(['one.md', 'two.png', 'three.md#part', 'five.md', 'https://example.org/x', '#local', 'seven.md'])
    expect(linksIn(markdown).filter(isRelative)).toEqual(['one.md', 'two.png', 'three.md#part', 'five.md', '#local', 'seven.md'])
  })

  // An anchor the reader computed otherwise than GitHub would refuse a
  // link that works, or pass one that opens at the top of the page. The
  // shapes the sections' headings take: a number with a point, code, a
  // link, a dash, a heading given twice, and a `#` inside a fence, which is
  // no heading.
  test("gives a heading GitHub's anchor", () => {
    const markdown = ['# 5. Building blocks', '## 11.4 The release gates still open', '### `@formancy/data-core`', '### [0005](x.md) and the gate', '## What it costs — and why ##', '## Notes', '## Notes', '```', '# not a heading', '```'].join('\n')
    expect([...anchorsOf(markdown)]).toEqual(['5-building-blocks', '114-the-release-gates-still-open', 'formancydata-core', '0005-and-the-gate', 'what-it-costs--and-why', 'notes', 'notes-1'])
  })

  // Each way a link opens on nothing, refused with its reason, beside a
  // link that works: past the root, a directory, a file git ignores, a
  // line anchor into source, a heading that is not there.
  test('refuses each link that leads nowhere, and only those', () => {
    const files = new Set(['docs/architecture/01-a.md', 'docs/decisions/README.md', 'packages/x/src/y.ts'])
    const read = (file) => (file === 'docs/decisions/README.md' ? '# Index\n' : '## Here\n')
    const markdown = '[ok](../decisions/README.md#index) [self](#here) [code](../../packages/x/src/y.ts) [up](../../../elsewhere.md) [dir](../decisions/) [plan](../plan.md) [line](../../packages/x/src/y.ts#L3) [gone](../decisions/README.md#nothing)'
    expect(linkProblems('docs/architecture/01-a.md', markdown, files, read)).toEqual([
      'docs/architecture/01-a.md: ../../../elsewhere.md leads out of the repository',
      'docs/architecture/01-a.md: ../decisions/ names docs/decisions, a directory: link its README.md',
      'docs/architecture/01-a.md: ../plan.md names docs/plan.md, which is no file git would commit',
      'docs/architecture/01-a.md: ../../packages/x/src/y.ts#L3 has a fragment into a file that is not Markdown, which nothing here can check',
      'docs/architecture/01-a.md: ../decisions/README.md#nothing names no heading of docs/decisions/README.md',
    ])
  })

  // A package's name inside a longer one is not that package: section 5
  // naming @formancy/data-core-extra alone must not count as naming
  // @formancy/data-core, nor data-core without its scope.
  test('finds a name whole, and not inside another', () => {
    expect(names('`@formancy/data-core` decides.', '@formancy/data-core')).toBe(true)
    expect(names('as @formancy/data-core.', '@formancy/data-core')).toBe(true)
    expect(names('`@formancy/data-core-extra`', '@formancy/data-core')).toBe(false)
    expect(names('data-core', '@formancy/data-core')).toBe(false)
  })
})

describe('what counts as a repository path', () => {
  const files = new Set([
    '.github/workflows/gates.yml',
    'apps/host/scripts/browser-test.mjs',
    'apps/studio/scripts/browser-test.mjs',
    'docs/decisions/README.md',
    'packages/data-core/src/records/plan.ts',
    'packages/data-core/src/records/list.ts',
    'scripts/source-size.test.mjs',
    'scripts/release-report/report.mjs',
    'README.md',
  ])

  // Too wide a rule refuses the sections' ordinary code -- a route, a
  // package's name, a placeholder path, a secret reference -- and gets
  // loosened until it holds nothing; too narrow a rule passes a misspelled
  // path because it never read it. The line is drawn at the repository's
  // own top-level directories, read from git, never listed here.
  test('is a code span with no space, holding a slash, that starts at a top-level directory', () => {
    const tops = topLevelDirectories(files)
    expect([...tops].sort()).toEqual(['.github', 'apps', 'docs', 'packages', 'scripts'])
    const spans = [
      'packages/data-core/src/records/plan.ts',
      'packages/data-core/',
      '.github/workflows/gates.yml',
      'apps/*/scripts/browser-test.mjs',
      'routes/runtime.ts',
      '@formancy/data-core',
      '<root>/<id>/<version>.json',
      'env:NAME',
      '/v1/forms',
      'README.md',
      'packages/data-core/src/records/plan.ts and more',
      'dist/main.mjs',
    ]
    expect(spans.filter((span) => isRepositoryPath(span, tops))).toEqual(['packages/data-core/src/records/plan.ts', 'packages/data-core/', '.github/workflows/gates.yml', 'apps/*/scripts/browser-test.mjs'])
  })

  // A code span in a fence is an example of a path, not a claim that one
  // exists; one wrapped over a line break is still one span, as CommonMark
  // reads it.
  test('is read from code spans outside fences, a wrapped span included', () => {
    const markdown = ['`packages/data-core/src/records/plan.ts` and `packages/data-core/src/records/`', '`scripts/release-report/', 'report.mjs`', '```', '`packages/gone.ts`', '```', '`` `apps/host/` ``'].join('\n')
    expect(codeSpansIn(markdown)).toEqual(['packages/data-core/src/records/plan.ts', 'packages/data-core/src/records/', 'scripts/release-report/ report.mjs', '`apps/host/`'])
  })

  // Each way a path names nothing, refused, beside each way one is right: a
  // file, a directory with or without its slash, a pattern that matches,
  // and a choice in braces every one of whose paths is there. One choice
  // misspelled among several is still a misspelled path.
  test('refuses a path or a pattern that names nothing git would commit, and only those', () => {
    const markdown = [
      '`packages/data-core/src/records/plan.ts`, `packages/data-core/src/records/`, `packages/data-core/src`,',
      '`apps/*/scripts/browser-test.mjs`, `scripts/**/*.test.mjs`, `packages/data-core/src/records/{plan,list}.ts`,',
      '`packages/data-core/src/records/plan.tsx`, `packages/data-core/src/record/`, `apps/*/scripts/pictures.mjs`,',
      '`packages/data-core/src/records/{plan,delete}.ts`, `routes/gone.ts`',
    ].join('\n')
    expect(pathProblems('docs/architecture/05-a.md', markdown, files)).toEqual([
      'docs/architecture/05-a.md: `packages/data-core/src/records/plan.tsx` names nothing git would commit',
      'docs/architecture/05-a.md: `packages/data-core/src/record/` names nothing git would commit',
      'docs/architecture/05-a.md: `apps/*/scripts/pictures.mjs` matches nothing git would commit',
      'docs/architecture/05-a.md: `packages/data-core/src/records/{plan,delete}.ts` names nothing git would commit as `packages/data-core/src/records/delete.ts`',
    ])
  })

  // A pattern read as more or less than a shell reads it would pass a
  // misspelled one or refuse a right one: `*` stays in its segment, `**`
  // crosses them, and a choice in braces is each of its paths.
  test('reads a pattern as a shell does', () => {
    expect(globPattern('apps/*/scripts/browser-test.mjs').test('apps/host/scripts/browser-test.mjs')).toBe(true)
    expect(globPattern('apps/*/browser-test.mjs').test('apps/host/scripts/browser-test.mjs')).toBe(false)
    expect(globPattern('scripts/**/*.test.mjs').test('scripts/source-size.test.mjs')).toBe(true)
    expect(globPattern('scripts/**/*.test.mjs').test('scripts/release-report/x/y.test.mjs')).toBe(true)
    expect(globPattern('apps/*').test('apps/host/scripts/browser-test.mjs')).toBe(true)
    expect(globPattern('packages/data-core/src/records/plan.ts').test('packages/data-core/src/records/plan+ts')).toBe(false)
    expect(expansions('.github/workflows/{gates,ci}.yml')).toEqual(['.github/workflows/gates.yml', '.github/workflows/ci.yml'])
    expect(expansions('packages/{a,b}/src/{c,d}.ts')).toEqual(['packages/a/src/c.ts', 'packages/a/src/d.ts', 'packages/b/src/c.ts', 'packages/b/src/d.ts'])
    expect(() => expansions('packages/{a,b/src')).toThrow(/does not close/)
  })
})
