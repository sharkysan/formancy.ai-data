// Types for walk.mjs, for the apps' suites that import it (apps/studio and
// apps/host, guide.test.tsx). walk.mjs is plain JavaScript so the gate can run
// it from a checkout with nothing installed; these say what it exports.

export interface Rule {
  column: string
  attribute: string
}

export type Action =
  | { kind: 'discover'; group: string; button: string; seen: string }
  | { kind: 'press'; opens?: string; shows?: string; says?: string }
  | { kind: 'select' | 'type'; value: string }
  | { kind: 'tick'; keep?: { group: string; ticked: readonly string[] }; holds?: { name: string; value: string } }
  | { kind: 'none'; reads: string }
  | { kind: 'rules'; rules: readonly Rule[]; from: string }
  | { kind: 'says'; text: string }

export interface WalkRow {
  step?: string
  control: string
  action: Action
}

export interface JourneyForm {
  engine: string
  connection: string
  root: { schema: string; name: string }
  formId: string
  title: string
  lookups: ReadonlyArray<{ foreignKey: string; display: readonly string[] }>
  pinned: readonly string[]
  versionColumn?: string | undefined
}

export interface JourneyEntry {
  field: string
  label: string
  value: string
  stored?: string | undefined
}

export interface Journey {
  forms: readonly JourneyForm[]
  policy: {
    operations: { read: readonly string[]; create: readonly string[]; update: readonly string[] }
    rowFilters: readonly Rule[]
    lookups: Readonly<Record<string, readonly Rule[]>>
  }
  order: {
    customer: { label: string; search: string; choose: string }
    create: readonly JourneyEntry[]
    update: JourneyEntry
  }
}

export declare const STUDIO: Readonly<{ token: string; signIn: string; steps: string; chose: string; policyCheck: string; fits: string }>
export declare const STUDIO_STEPS: Readonly<{ connect: string; choose: string; generate: string; policy: string; publish: string }>
export declare const HOST: Readonly<{
  token: string
  formId: string
  open: string
  newRecord: string
  save: string
  created: string
  saved: string
  signOut: string
  record: string
  load: string
  notFound: string
}>
export declare function stepTitle(step: string): string
export declare function studioWalk(journey: Journey, form: JourneyForm): WalkRow[]
export declare function labelOf(journey: Journey, field: string): string
export declare function guideNames(journey: Journey): Set<string>
