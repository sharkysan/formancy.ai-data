import { describe, expect, test } from 'vitest'
import { TENANTS } from './data/model.js'
import { DEMO_FORMS, describeGrants, PERSONAS, ROLE_GRANTS } from './personas.js'

/**
 * The people a visitor signs in as. What each may do is ROLE_GRANTS alone:
 * image/forms.ts grants exactly that in each form's policy, and
 * image/publish.integration.test.ts reads every persona's menu back from
 * the real server against it. The sentence the page shows is derived from
 * the same table here, so it cannot claim what the policy does not grant.
 */
describe('the personas', () => {
  // The sentence is what the page says; pinned here once, in full, so a
  // change to how it is derived is a change somebody reads.
  test("say what their role grants, in their tenant's words", () => {
    expect(PERSONAS.map(({ id, name, roles, tenant, description }) => ({ id, name, roles, tenant, description }))).toEqual([
      {
        id: 'clara',
        name: 'Clara',
        roles: ['clerk'],
        tenant: 1,
        description:
          "Order clerk of tenant 1: reads tenant 1's customers, orders, order lines and deliveries, and nothing of tenant 2's; adds customers; adds, changes and deletes orders and deliveries; adds and changes order lines.",
      },
      {
        id: 'otto',
        name: 'Otto',
        roles: ['clerk'],
        tenant: 2,
        description:
          "Order clerk of tenant 2: reads tenant 2's customers, orders, order lines and deliveries, and nothing of tenant 1's; adds customers; adds, changes and deletes orders and deliveries; adds and changes order lines.",
      },
      {
        id: 'vera',
        name: 'Vera',
        roles: ['auditor'],
        tenant: 1,
        description: "Auditor of tenant 1: reads tenant 1's customers, orders, order lines and deliveries, and nothing of tenant 2's; changes nothing.",
      },
    ])
  })

  // A sentence typed beside the table would go on saying "deletes order
  // lines" after the table stopped granting it. Derived, it cannot.
  test('describe what the table grants, not what they once did', () => {
    const may = { ...ROLE_GRANTS.clerk.may, delivery: ['read'] as const, customer: ['read', 'create', 'update'] as const }
    expect(describeGrants('Clerk', may, 2)).toBe(
      "Clerk of tenant 2: reads tenant 2's customers, orders, order lines and deliveries, and nothing of tenant 1's; adds and changes customers and order lines; adds, changes and deletes orders.",
    )
    expect(describeGrants('Reader', { ...ROLE_GRANTS.auditor.may, delivery: [] }, 1)).toBe(
      "Reader of tenant 1: reads tenant 1's customers, orders and order lines, and nothing of tenant 2's; changes nothing.",
    )
  })

  // The menu names only forms a person may read, and a delete names the
  // version its person read (0050): a grant to change what one cannot read
  // would be a sentence on the page no grid ever shows.
  test('may change only what they may read', () => {
    const unread = Object.entries(ROLE_GRANTS).flatMap(([role, { may }]) =>
      DEMO_FORMS.filter((form) => may[form.id].length > 0 && !may[form.id].includes('read')).map((form) => `${role} on ${form.id}`),
    )
    expect(unread).toEqual([])
  })

  // Isolation is what the demo shows: each tenant has a clerk to show it
  // from, and every persona belongs to a tenant the data has.
  test('give each tenant a clerk, and each persona a tenant the data has', () => {
    for (const tenant of TENANTS) expect(PERSONAS.some((persona) => persona.tenant === tenant && persona.roles.includes('clerk'))).toBe(true)
    for (const persona of PERSONAS) expect(TENANTS).toContain(persona.tenant)
  })

  // The id is the token's subject and what the sign-in button posts: one
  // spelling, which nothing has to escape, and never two personas sharing it.
  test('have distinct ids in plain lower case', () => {
    const ids = PERSONAS.map((persona) => persona.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(id).toMatch(/^[a-z]+$/)
  })

  // Every role a persona carries has a row in the table, which is what the
  // policy is derived from: a role with none would be granted nothing.
  test('carry only roles the table grants', () => {
    for (const persona of PERSONAS) for (const role of persona.roles) expect(Object.keys(ROLE_GRANTS)).toContain(role)
  })
})
