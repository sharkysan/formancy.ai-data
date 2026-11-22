# Live demo

The live demo: whom you sign in as, what you meet there, what it costs the
rightsholder, how it runs, and what tests it.

https://formancy.ai/data/demo/ is the product itself, live: the host page's
workspace over a data server and a PostgreSQL database of your own, main's,
started on Cloudflare when you sign in, with sample sales data. Its Worker
was created on 2026-10-19, as [the setup page](../setup.md) records, by the
steps in [REPO-METADATA.md](../../.github/REPO-METADATA.md#creating-the-live-demos-worker),
which also holds [its settings](../../.github/REPO-METADATA.md#the-live-demos-worker-on-cloudflare)
([0070](../decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md)).

You sign in as one of three people, each sentence the page shows derived
from what the forms' policies grant:
- **Clara**, order clerk of tenant 1: reads tenant 1's customers, orders,
  order lines and deliveries, and nothing of tenant 2's; adds customers;
  adds, changes and deletes orders and deliveries; adds and changes order
  lines.
- **Otto**, the same for tenant 2.
- **Vera**, auditor of tenant 1: reads, and changes nothing.

Each tenant has 120 customers and 420 orders, with their lines and
deliveries, generated from a fixed seed and dated back from a fixed day, so
every build holds the same rows (`apps/live-demo/src/data/`). Search the
orders and page through them, open
one with its lines and deliveries in tabs beside it, find a customer with
the typeahead, change an order, add one with a line and delete it again. As
Otto, tenant 1's orders are not there; as Vera, every write is refused. The
four forms are what the generator made from the demo account's grants,
published when the image is built through the real administrator's plane:
the customer form offers no change or delete and the order line no
delete, for the reasons the generator's notes give.

**What you meet.**
- Your first sign-in waits while your server starts: 5.7 to 11.7 s through
  the Worker at the instance's share of a CPU on a workstation, over four
  runs on 2026-10-17, and not yet measured on Cloudflare.
- Everything you change is gone when your server stops, a little over 10
  minutes after your last request, and on every deploy. Sign in again and the data is as
  generated.
- One cookie, `__Secure-formancy-data-demo`, holds a random name for your
  server and nothing else, and goes when the browser closes. Whoever holds
  it can sign in to your server: it is the only credential your changes
  have. Your token stays in the page's memory, as the host page always
  keeps it, and lasts an hour: a visit longer than that is refused "A
  valid host token is required." until you sign out and sign in again,
  which reaches the same server and what you changed while it runs.
- At most 10 servers run at once, and one visitor can hold them all; when
  none can start, the sign-in says so.
- PostgreSQL only. Cloudflare decrypts what you send, and holds what you
  type in your container until it stops: the data is synthetic, and what
  you type should be too.

**What it costs the rightsholder.** Cloudflare's Workers Paid plan, and for
each running server its memory and disk, and its CPU while busy. The cap
bounds it; 0070 does the sums at the prices read, and names every other
cost.

**How it runs.** One Worker, `formancy-data-demo`, routed at `/data/demo/`
of formancy.ai and nowhere else, serves the host page's demo build as static
files and answers two things itself: the people and a sign-in, at
`/data/demo/session`, and the runtime plane's routes under
`/data/demo/v1/forms`, exactly those 0037's runtime door forwards and none
of the administrator's beside them, which it forwards to your server
through a Durable Object of yours.
Only a sign-in from the page starts a server: no link, crawler or form on
another site does. Each start makes a new key, so a token from before a
restart is refused. The image, `deploy/demo/Dockerfile`, is PostgreSQL 17
with the demo's data, and the data server built from the checkout beside
it, with the runtime plane alone; its disk is the image's on every start.
The page's Content-Security-Policy is the examples page's with inline
styles allowed, which AG Grid's theme needs, and nothing else.
The page asks search engines to index it at https://formancy.ai/data/demo/,
which it names as its canonical address, with a description of the demo
in place of the host page's: the deploy writes both into the copy it
stages and drops the host page's `noindex` from it. The host page's own
build, which the composed stack serves, still asks to be left out, and a
crawler starts no server
([0177](../decisions/0177-the-examples-page-and-the-live-demo-ask-to-be-indexed-each-at-its-own-address-and-only-the-deploy-that-puts-it-there-says-so.md)).

Cloudflare's Workers Builds deploys it from `main` on every push, with
`pnpm build` and `node scripts/live-demo.mjs`, as it deploys the examples
page; GitHub's workflows hold no Cloudflare token and never deploy. By
hand, `pnpm live-demo:deploy` deploys from a clean checkout of `main` with
Docker running, after the Wrangler login
[RELEASING.md](../../RELEASING.md#the-live-demo-on-formancyai) names, and
`node scripts/live-demo.mjs --dry-run`, after `pnpm build`, checks the
config and the build and uploads nothing.

`pnpm test:live-demo`, which needs Docker, builds the image and runs the
Worker's own code in front of it, over a stand-in for Cloudflare's runtime
whose containers are `docker run`s at the instance's share of a CPU and its
memory, and walks a visitor's journey over HTTP and then in Chromium; CI
runs it in a job of its own. `wrangler dev` is not the gate: it runs no
container on Windows, nor against Docker Desktop's kernel in WSL, so the
Worker's Durable Object code on Cloudflare is held by review until the
first deploy is read.
