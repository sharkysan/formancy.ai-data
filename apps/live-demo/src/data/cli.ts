/*
 * Writes the live demo's SQL to standard output: `node dist/data/cli.mjs >
 * demo-data.sql`, as the image's build runs it. A composition root: what it
 * writes is demoSql's, tested in render.test.ts and loaded into a real
 * PostgreSQL by load.integration.test.ts, and it fails, writing nothing, on
 * data that breaks an invariant.
 */
import { demoSql } from './render.js'

process.stdout.write(demoSql())
