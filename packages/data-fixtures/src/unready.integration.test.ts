import { fileURLToPath } from 'node:url'
import { BoundPorts, getContainerRuntimeClient, Wait } from 'testcontainers'
import { expect, test } from 'vitest'
import { CALLER_LABEL, startSqlServerContainer } from './containers.js'
import { selectedImage } from './images.js'
import { logLines, reportingUnready } from './unready.js'

/*
 * A SQL Server container that stops before it says it is ready fails its
 * start with Docker's account of how it ended and the end of its log
 * (0082), not with testcontainers' "Log stream ended and message ... was
 * not received" alone, which is all CI said of the two starts that failed
 * that way (runs 39024938334 and 39059935690, 2026-10-17).
 *
 * The container is stopped as the OOM killer or a crash would stop it:
 * from outside and without warning, SIGKILL, once SQL Server has begun to
 * start -- once it has written a line of its own, which it timestamps --
 * and long before it is ready. It is found by the label naming this file,
 * which no other suite's container carries (fixtures.integration.test.ts).
 */
const HERE = fileURLToPath(import.meta.url)

/** The first lines SQL Server itself writes, unlike the image's entrypoint, begin with its own timestamp. */
const SERVER_LINE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}\.\d{2} /

type Dockerode = Awaited<ReturnType<typeof getContainerRuntimeClient>>['container']['dockerode']

/** This file's container, once Docker lists it and SQL Server in it has written a line; with the lines it had written. */
async function whenSqlServerHasWritten(docker: Dockerode): Promise<{ id: string; lines: string[] }> {
  // A pull of the image, on a runner that has never pulled it, is part of the start.
  const deadline = Date.now() + 600_000
  for (;;) {
    const [listed] = await docker.listContainers({ filters: { label: [`${CALLER_LABEL}=${HERE}`] } })
    if (listed !== undefined) {
      const lines = logLines(await docker.getContainer(listed.Id).logs({ stdout: true, stderr: true, follow: false }))
      if (lines.some((line) => SERVER_LINE.test(line))) return { id: listed.Id, lines }
    }
    if (Date.now() > deadline) throw new Error(`no container labelled ${CALLER_LABEL}=${HERE} wrote a line of SQL Server's in ten minutes`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

// What CI's two failed starts would have said with this in place. Without
// it the start fails with testcontainers' sentence and nothing after it:
// the container is removed by the time anyone could ask, and an OOM kill,
// a crash and a kill read the same.
test('a SQL Server container killed before it is ready fails its start with how it ended and the lines it wrote', { timeout: 900_000 }, async () => {
  const image = selectedImage('sqlserver')
  const docker = (await getContainerRuntimeClient()).container.dockerode
  const starting = startSqlServerContainer(image).then(
    async ({ container }) => {
      await container.stop()
      return undefined
    },
    (error: unknown) => error,
  )
  const { id, lines } = await whenSqlServerHasWritten(docker)
  await docker.getContainer(id).kill()
  const error = await starting

  expect(error).toBeInstanceOf(Error)
  const message = (error as Error).message
  expect(message).toMatch(/^Log stream ended and message "\/\.\*Recovery is complete\.\*\/" was not received; /)
  expect(message).toContain(`; container ${id.slice(0, 12)} of ${image} had stopped (exited): exit code 137, not killed by the OOM killer, started `)
  for (const line of lines) expect(message).toContain(line)
})

// The report is made where the start already failed: Docker's own refusal
// to answer, a 404 for a container removed while it started, must leave
// the strategy's error and add Docker's, never replace it or throw past it.
// And the strategy's error for a container that is gone is CI's sentence
// too: testcontainers' log stream of a container Docker does not know ends
// as one that stopped does (observed here, 2026-10-17), so only Docker's
// answer after it tells a removal from a stop.
test("a container Docker no longer knows is reported in Docker's words, after the strategy's own error", async () => {
  const docker = (await getContainerRuntimeClient()).container.dockerode
  const gone = docker.getContainer('formancy-data-fixtures-no-such-container')
  const error = await reportingUnready(Wait.forLogMessage(/never/, 1))
    .waitUntilReady(gone, new BoundPorts())
    .then(
      () => undefined,
      (error: unknown) => error,
    )
  expect(error).toBeInstanceOf(Error)
  expect((error as Error).message).toMatch(
    /^Log stream ended and message "\/never\/" was not received; Docker could not say how container formancy-dat ended: \(HTTP code 404\) no such container/,
  )
})
