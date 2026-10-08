# Formancy Data Source-Available Licence

**Version 0 — DRAFT of 8 October 2026. Not yet reviewed by a lawyer.**

This text states the terms Formancy Data is intended to be offered under. It is
published in the repository so that the terms are visible from the first
commit, and it is marked a draft because it has not had legal review: the
definitions of production and redistribution, the governing law and the
mechanics of termination all need a lawyer's reading before this is relied on
either way. Until a reviewed version replaces it, the rightsholder grants the
free rights in the table below and nothing beyond them.

This is not an open-source licence. It is not Apache-2.0, and it is not the
licence of [formancy](https://github.com/sharkysan/formancy.ai), on which this
software builds and whose packages keep their own Apache-2.0 terms.

## The terms in one table

| Use | Terms |
| --- | --- |
| Read the source and fork the repository | Free |
| Evaluate, develop and test — including in companies | Free |
| Run in production, internally or customer-facing | Paid licence |
| Redistribute inside another software product | Separate commercial agreement |
| Customer data and generated form definitions | Remain the customer's |

The rest of this document says what each row means.

## 1. Definitions

**The Software** means the source code, declarations, documentation and
packages in this repository and the packages published from it under the
`@formancy/data-*` names, in any version, including modified versions.

**The Rightsholder** means Daniel Bacher, or whoever the Rightsholder later
designates in a revision of this document.

**Production Use** means running the Software, or anything that incorporates
it, in a way that serves real end users or real business operations: an
application people other than its developers and testers rely on, whether
inside one organisation or offered to others, whether or not it earns money.
Production is defined by operational use, not by revenue.

**Development Use** means any use that is not Production Use: reading,
evaluating, building, modifying, testing, demonstrating and running in
development, test, staging and continuous-integration environments, including
by and within a commercial organisation. A staging environment that real
users depend on is Production Use whatever it is called.

**Redistribution** means delivering the Software, or anything that
incorporates it, to a third party as part of a software product, a managed
service, a platform or a toolkit, such that the third party runs it rather
than you.

**Customer Data** means the contents of any database the Software connects to,
and anything the Software reads from or writes to it.

**Generated Definitions** means the form documents, bindings, layouts,
policies and other configuration the Software generates or that a person
creates with it.

## 2. What is free

Subject to section 4, the Rightsholder grants you a worldwide, royalty-free,
non-exclusive licence to:

1. read, copy, fork and modify the Software;
2. use the Software and your modifications for Development Use, without limit
   of time, number of people or size of organisation;
3. share the Software and your modifications with others for their
   Development Use, under this licence and with this document attached.

No production licence is required to evaluate the Software for as long as you
like, and no evaluation period expires.

## 3. What is paid

**Production Use requires a production licence from the Rightsholder.** A
production licence is a separate written agreement. It is expected to be
granted per application, to cover that application's development, test and
replica environments without further charge, to specify support and update
entitlements, and to leave you the right to keep running the versions you
licensed if you later choose not to renew. Those are intentions; the agreement
you sign is what governs.

**Redistribution requires a separate commercial agreement.** Shipping the
Software inside a product, a platform or a managed service that other parties
run is not covered by a production licence for your own applications.

Running the Software in production without a production licence is a breach of
this licence.

## 4. Conditions

1. **Notices travel.** A copy of this document, and the NOTICE file, stays
   with every copy and every modified version of the Software.
2. **Modified versions carry these terms.** A modified version of the Software
   is the Software for the purposes of this licence. You may not remove or
   circumvent the terms by modifying it.
3. **No trademark grant.** This licence grants no right to use the names
   "Formancy", "Formancy Data", "formancy.ai" or any associated logo, beyond
   what is needed to identify the Software truthfully.
4. **Third-party components keep their own licences.** The Software depends on
   packages licensed under the Apache License, Version 2.0, among others. Those
   licences continue to govern those components, their notices are preserved
   in NOTICE, and nothing in this document narrows the rights they grant.

## 5. What stays yours

**Customer Data remains the customer's.** This licence grants the Rightsholder
no right of any kind over the contents of any database the Software connects
to, and the Software is designed not to send any of it anywhere.

**Generated Definitions remain yours.** Form documents, bindings, layouts and
policies you generate or author with the Software are yours, under whatever
terms you choose. They are not the Software, and this licence does not
restrict them — including after a production licence ends.

## 6. Contributions

Contributions to the Software are accepted under the Contributor License
Agreement in `CLA.md`, which grants the Rightsholder the right to distribute
them under this licence and under commercial agreements, and transfers no
ownership.

## 7. Termination

Your rights under this licence end automatically if you breach it and do not
cure the breach within thirty days of becoming aware of it. The rights in
section 5 do not end: your data and your generated definitions stay yours in
every case.

## 8. No warranty, limited liability

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NON-INFRINGEMENT. IN NO EVENT SHALL THE
RIGHTSHOLDER BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN
ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

A production licence may provide warranties and support; this document does
not.

## 9. Obtaining a production licence

The Software is new and has no published price. Until it does, write to the
Rightsholder through the repository's contact details; the plan is to set the
price after the first design partners have established what the Software is
worth to them.
