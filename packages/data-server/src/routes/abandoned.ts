import type { FastifyReply, FastifyRequest } from 'fastify'

/** A lookup request's signal, aborted when its client leaves before the answer, and the call that stops listening. */
export interface Abandonment {
  readonly signal: AbortSignal
  /** Removes the listeners: called once the route has its answer, whichever way. */
  settle(): void
}

/** What the signal is aborted with: an AbortError, so a route tells it from a database's failure by identity. */
const LEFT = 'The client closed the connection before the answer.'

/**
 * Whether the browser gave up on this request before it was answered (0061).
 *
 * Two events say so, measured on Fastify 5.12.5 with Node 24 and Node 22 on
 * 2026-10-14: the response's `close` before it finished writing, and the
 * socket's `close`. The socket is needed for a request pipelined behind
 * another, whose response has no socket of its own until the answer before
 * it is written: on Node 22 such a response emits no `close` when the
 * connection goes (on Node 24 it does), as audit.ts found for its event. Two
 * events that look as if they say so do not: the request's `close` fires as
 * soon as its body is read, and Fastify's `onRequestAbort` never runs once
 * it was. A socket already destroyed has gone already.
 *
 * `settle()` removes both listeners: a keep-alive socket carries request
 * after request, and would otherwise gather one per request.
 */
export function abandonment(request: FastifyRequest, reply: FastifyReply): Abandonment {
  const controller = new AbortController()
  const response = reply.raw
  const socket = request.raw.socket
  const gone = (): void => {
    if (!response.writableFinished) controller.abort(new DOMException(LEFT, 'AbortError'))
  }
  response.once('close', gone)
  socket.once('close', gone)
  if (socket.destroyed) gone()
  return {
    signal: controller.signal,
    settle() {
      response.off('close', gone)
      socket.off('close', gone)
    },
  }
}
