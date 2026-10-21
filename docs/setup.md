# Setting it up

What Formancy Data needs that is not in this repository's files: GitHub's
settings and secrets, a registry's visibility, and Cloudflare's account and
Workers. It is listed in the order somebody sets it up, with who does each
step and whether it was found done. The settings themselves are written
where their guards hold them, and this page links to them rather than
repeating them.

Running Formancy Data yourself is not here. That is
[the getting-started guide](getting-started.md), and, with Cloudflare at
the edge, [the Cloudflare deployment](deploy/cloudflare.md).

## What is done

Read on 2026-10-17. Nothing reads it again, so a setting changed since
then is not seen here. Each row says how it was read, so it can be read
again.

| # | What | Who | On 2026-10-17 | Read with |
|---|---|---|---|---|
| 1 | The repository's description and topics | the maintainer, with `gh` | done | `gh api repos/sharkysan/formancy.ai-data` |
| 2 | A merged branch deleted by the merge ([0036](decisions/0036-a-merged-branch-is-deleted-by-the-merge.md)) | the maintainer, in GitHub's settings | done | the same call: `delete_branch_on_merge` is true |
| 3 | `CODECOV_TOKEN`, a repository secret | the maintainer | done | `gh secret list`, which lists names and never values |
| 4 | The `npm` environment, its policy of `v*` tags, and its secret `NPM_TOKEN` | the maintainer | done: 0.1.0 was published through it on 2026-10-16 | `gh api repos/sharkysan/formancy.ai-data/environments` and `gh secret list -e npm` |
| 5 | The server's image public on GHCR | the first release | done | `docker manifest inspect ghcr.io/sharkysan/formancy-data-server:v0.1.0` with no login |
| 6 | The examples page's Worker, `formancy-data-examples` | the maintainer, once | done: live since 2026-10-16 | read by hand on 2026-10-16 ([0069](decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)) |
| 7 | The Workers Paid plan on formancy.ai's Cloudflare account | the maintainer: it is billing | done by 2026-10-19: the demo's container application was deployed, which the free plan cannot hold | `npx --yes wrangler@4.146.0 containers list`, after the Wrangler login |
| 8 | The live demo's Worker, `formancy-data-demo` | the maintainer, once | done on 2026-10-19; its pages answer, and every sign-in failed that day ([0086](decisions/0086-a-failed-start-of-the-live-demo-says-why-in-the-workers-live-log.md)) | `npx --yes wrangler@4.146.0 deployments list --name formancy-data-demo` |
| 9 | That Worker connected to this repository, so that a push to `main` deploys it | the maintainer, once | done on 2026-10-19, in the dashboard | the Worker's *Builds* tab, which nothing here reads |
| 10 | A rate limit on starting a demo server | the maintainer, if wanted | not set | |

## GitHub: rows 1 to 5

1. **Description and topics.** Run the command under
   [*Apply*](../.github/REPO-METADATA.md#apply) once, and again whenever
   that file changes.
2. **A merged branch is deleted.** In GitHub, *Settings › General › Pull
   Requests › Automatically delete head branches*. 0036 says why nothing
   else deletes one.
3. **Codecov.** Codecov's token for this repository, as a repository
   secret named `CODECOV_TOKEN`. Without it the coverage upload is skipped,
   and visibly so
   ([what each secret does](../.github/REPO-METADATA.md#secrets-the-workflows-expect)).
4. **npm.** An environment named `npm`, whose deployment policy admits only
   tags matching `v*`, holding an Automation or Granular Access token as
   `NPM_TOKEN`. [RELEASING.md](../RELEASING.md#secrets) says why it is an
   environment's secret and not the repository's. A Granular Access token
   limited to the packages it names must name `@formancy/data-identity`
   too before 0.3.0, the first release that publishes it
   ([0091](decisions/0091-the-host-identity-verifier-is-a-package-of-its-own-which-the-server-re-exports.md)).
5. **The image.** The release workflow pushes it to GHCR. If GitHub ever
   shows the package as private, change it under the package's *Package
   settings › Change visibility*.

## Cloudflare: the examples page, row 6

Done. The Worker deploys the examples page from `main` on every push.
How it was created, and how to create it again, is under
[*Creating the Worker*](../.github/REPO-METADATA.md#creating-the-worker).
[RELEASING.md](../RELEASING.md#the-demo-on-formancyai) says what to check
after a deploy.

## Cloudflare: the live demo, rows 7 to 10

Until these are done, https://formancy.ai/data/demo/ is formancy.ai's 404.

7. **Workers Paid.** In Cloudflare's dashboard, *Workers & Pages › Plans*.
   Containers are not on the free plan (Cloudflare's pricing page, read on
   2026-10-16). The plan is $5 a month. What the demo can cost at most, and
   what bounds it, is in
   [0070](decisions/0070-the-live-demo-runs-the-real-server-and-postgresql-in-a-cloudflare-container-of-each-visitors-own.md).
8. **and 9. The Worker, and its connection.** Either:
   - **In the dashboard alone**, which creates the Worker, connects it and
     deploys `main` in one go: *Workers & Pages › Create › Import a
     repository › GitHub*, the repository `sharkysan/formancy.ai-data`, and
     [the settings in the table](../.github/REPO-METADATA.md#the-live-demos-worker-on-cloudflare).
     Then, on the Worker, *Settings › Build › Branch control*: clear
     **Enable Preview Builds**, Cloudflare's name for builds of branches
     other than the production branch.
   - **Or from a clean checkout of `main`**, with Docker running, then
     connected:

     ```bash
     npx --yes wrangler@4.146.0 login     # once per machine; opens a browser
     pnpm live-demo:deploy                # creates the Worker and its container, and pushes the image
     ```

     Then, in the dashboard, *formancy-data-demo › Settings › Build ›
     Connect*, with the same settings, and branch control as above. Without
     the connection, nothing deploys the demo again when `main` moves.

   The steps in full are under
   [*Creating the live demo's Worker*](../.github/REPO-METADATA.md#creating-the-live-demos-worker).
10. **A limit on starts, if wanted.** One visitor can take every place
    `max_instances` allows. A rate-limiting rule of the zone on
    `POST /data/demo/session` bounds that. It is the operator's choice, and
    [nothing here sets it](../.github/REPO-METADATA.md#a-limit-on-starts-if-wanted).

After the first deploy, make the five reads that
[RELEASING.md](../RELEASING.md#the-live-demo-on-formancyai) lists, and
record what they found in 0070. Nothing here can measure them: the start on
Cloudflare, the headers, what `max_instances` answers, how long a server
outlives its visitor, and the images held.

## What cannot be set up automatically, and why

Three steps need a person:

- **Billing.** Workers Paid is a payment.
- **A login.** Wrangler's login opens a browser, and the account must be
  able to edit Workers and Containers on formancy.ai's account and zone.
- **Connecting Cloudflare to GitHub.** Workers Builds connects a Worker to
  a repository in Cloudflare's dashboard.

No workflow here holds a Cloudflare token, by design
([0069](decisions/0069-the-examples-page-is-served-at-formancy-ai-data-examples.md)),
so CI cannot create or deploy a Worker. Once the steps above are done,
everything runs without anybody:

- both Workers deploy `main` on every push;
- a release publishes the packages and the image from a tag, as
  [RELEASING.md](../RELEASING.md) describes.

## What holds this page

- `scripts/setup.test.mjs`, in `pnpm test:repo`, fails when any of these
  stops matching:
  - the Workers this page names and the ones the apps' `wrangler.json`
    files deploy;
  - the `pnpm` scripts it says to run and the root `package.json`;
  - the Wrangler it pins and the one the deploys run.

  It also fails when the README or the documentation's entry no longer
  links this page.
- `scripts/architecture.test.mjs` fails on a link of this page that leads
  nowhere, and on a repository path in backticks that names nothing.
- Nothing reads the *What is done* table.
