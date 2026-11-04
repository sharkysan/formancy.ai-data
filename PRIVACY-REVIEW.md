# Privacy review

Reviewed on 4 November 2026, against the live deployment. The notice that covers this product's
demonstration is formancy.ai's [privacy notice](https://formancy.ai/privacy/), and this file is
what it rests on for Formancy Data.

- **Where it runs.** At [https://formancy.ai/data/examples/](https://formancy.ai/data/examples/), served by the
  Worker `formancy-data-examples`, which serves files and runs no code of its own: `apps/examples/wrangler.json` names
  assets and no script.
- **Cookies, storage and tracking.** Read from the live demonstration: no response sets a cookie,
  and its script uses no browser storage and holds no analytics, Zaraz or Turnstile script.
- **What a visitor types.** It is sent nowhere. The page's code requests only its own files, and
  its content security policy allows connections to its own origin alone (`connect-src 'self'`), and `apps/examples/scripts/browser-test.mjs` refuses and names any request it makes to another origin.
- **Cloudflare.** It delivers the demonstration as it delivers the rest of formancy.ai; the
  privacy notice says what it processes and names the safeguards it states for transfers.
- **Consent.** Nothing optional is set or read, so there is nothing to ask consent for.

Nothing re-reads the live deployment: read it again when the demonstration's deployment or
Cloudflare's settings for formancy.ai change, and date what was read.
