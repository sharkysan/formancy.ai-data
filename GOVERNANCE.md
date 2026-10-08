# Governance

Formancy Data is maintained by a single maintainer, who is the final
decision-maker on technical direction, releases, licensing and roadmap, and who
is the rightsholder named in `LICENSE.md`. This is stated plainly rather than
dressed up as a committee: the project is new, and pretending otherwise would be
misleading.

## Decisions

Decisions and their reasoning are recorded in `docs/decisions/`. If you disagree
with one, open an issue referencing it rather than a pull request — the
reasoning matters more than the code. A decision that depends on one made in
formancy.ai cites it by repository and number.

## Contributing

Contributions are taken under a CLA — [`CLA.md`](CLA.md) is the agreement and
[`CONTRIBUTING.md`](CONTRIBUTING.md) explains the trade. The record of who has
agreed, and to which version of the text, is
[`.github/cla/signatories.json`](.github/cla/signatories.json);
`.github/workflows/cla.yml` reads the commit authors of every pull request and
fails naming any it has no signature for, and `pnpm test:repo` fails on the
commit that changes the text under a signature.

What that check cannot do is refuse a merge. `main` carries no branch protection
rule, so no check here is mechanically required; what stops a red one from being
merged is a maintainer reading it. Said plainly because the existence of a gate
invites the opposite assumption.
