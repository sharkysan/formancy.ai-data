// `cloudflare:workers`, as `pnpm test:live-demo` gives it to the live demo's
// Worker (0070): the one name the Worker imports from it, DurableObject, the
// base class its DemoServer extends. On Cloudflare the class is the
// runtime's and its constructor keeps the object's state and environment as
// `ctx` and `env`; here that is all it does, and everything the Worker
// reaches through them -- storage, the container -- is the gate's stand-in
// (cloudflare.mjs). Mapped to that specifier by hooks.mjs.

export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx
    this.env = env
  }
}
