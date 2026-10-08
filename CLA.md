# Formancy Data Contributor License Agreement

Version 1. Adapted from the Apache Software Foundation's Individual Contributor
License Agreement, shortened, and with no copyright assignment — the same
shape formancy.ai uses, and for a stronger reason: this project distributes
its software under a source-available licence and under commercial agreements,
and needs permission to do that with what you contribute.

**Read [`CONTRIBUTING.md`](CONTRIBUTING.md) first.** It explains the trade in
plain words. This file is the terms themselves.

## 1. Definitions

**"You"** means the individual or legal entity agreeing to these terms.

**"Contribution"** means any work of authorship you intentionally submit to this
project for inclusion in it — code, documentation, tests, schemas, anything — in
any form, including a pull request, a patch, or a commit pushed to a branch of
this repository.

**"The project"** means Formancy Data, its maintainers, and anyone who receives
software distributed by them.

## 2. Copyright licence

You grant the project a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable copyright licence to reproduce, prepare derivative
works of, publicly display, publicly perform, **sublicense** and distribute your
Contribution and such derivative works.

The right to sublicense is the point of this document. It is what allows the
project to distribute your Contribution under the Formancy Data
Source-Available Licence and under commercial production agreements — which
is how the project is funded, and which `CONTRIBUTING.md` describes rather
than hides.

## 3. Patent licence

You grant the project a perpetual, worldwide, non-exclusive, no-charge,
royalty-free, irrevocable patent licence to make, have made, use, offer to sell,
sell, import and otherwise transfer your Contribution, where that licence applies
only to those patent claims licensable by you that are necessarily infringed by
your Contribution alone or by its combination with the project.

If you institute patent litigation against anyone alleging that the project or a
Contribution within it constitutes patent infringement, the patent licences
granted to you under this agreement terminate as of the date that litigation is
filed. This mirrors Apache-2.0 section 3.

## 4. You keep your work

**This agreement transfers no ownership.** You retain all right, title and
interest in your Contribution. It grants permission, not property. You may use
your Contribution for anything else you like, including under other licences.

You are not asked to assign copyright, and you will not be.

## 5. What you are stating

1. You are legally entitled to grant the licences above.
2. Each Contribution is your original creation, or you have the right to submit
   it under these terms and have identified any part that is not yours together
   with the licence or restriction it carries.
3. If your employer has rights to intellectual property you create, you have
   permission to make the Contribution on their behalf, or your employer has
   waived those rights, or your employer has agreed to these terms separately.
4. You will tell the project if any of the above stops being true.

## 6. No warranty

Except for the statements in section 5, you provide your Contribution "as is",
without warranties or conditions of any kind.

## 7. Outbound licence

Nothing here changes what anybody receives. Every published package of this
project is distributed under [`LICENSE.md`](LICENSE.md), and its Apache-2.0
dependencies keep their own terms, patent grant and retaliation clause. This
agreement is about what the project may do with Contributions, not about what
the public gets.

## How to sign

Signing is a commit in this repository, under your own git identity, adding
yourself to [`.github/cla/signatories.json`](.github/cla/signatories.json).
There is no third-party service and no form.

1. Get the hash of these terms as they currently stand:

   ```sh
   node scripts/check-cla.mjs --hash
   ```

2. Add an entry to `signatories` in that file, in the same pull request as your
   work or in one of its own:

   ```json
   {
     "name": "Your Name",
     "login": "your-github-login",
     "emails": ["the@address.you.commit.from"],
     "signed": "2026-10-08",
     "agreement": "sha256:…the hash from step 1…"
   }
   ```

   List every address you commit from. The check reads commit **authors**, so an
   address you have configured on a second machine belongs here too.

3. Commit that change yourself. **The commit is the signature**: it carries your
   git identity, the date, and the hash of the exact text you are agreeing to.
   Adding somebody else's entry on their behalf signs nothing.

`.github/workflows/cla.yml` runs the check on every pull request and names any
author it has no signature for.

### If the terms change

The hash you record is the hash of this file. Editing this file — even to fix a
typo — makes every recorded signature stale, and both the pull-request check
and `pnpm test:repo` say so by name rather than passing quietly. That is
deliberate: a signature that does not name what was signed is a date next to a
name.
