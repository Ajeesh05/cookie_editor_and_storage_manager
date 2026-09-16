import { test, expect } from './fixtures.js'

/**
 * These run the real pipeline: the packed extension in real Chromium, the real
 * service worker, real chrome.cookies and real chrome.scripting injection into
 * a page served over http. Only chrome.tabs.query is pinned - see fixtures.js
 * for why.
 */

const rows = panel => panel.locator('#table .grid-row')
const rowNamed = (panel, name) => rows(panel).filter({ hasText: name })
const storeTab = (panel, store) => panel.locator(`#tabs [data-store="${store}"]`)

test.describe('cookies', () => {
  test('lists the cookies set by the active tab', async ({ sidePanel }) => {
    const { panel } = sidePanel

    await expect(rowNamed(panel, 'fixture_cookie')).toHaveCount(1)
    await expect(rowNamed(panel, 'second_cookie')).toHaveCount(1)
    await expect(rowNamed(panel, 'fixture_cookie')).toContainText('cookie-value')
  })

  test('filters the grid as you type', async ({ sidePanel }) => {
    const { panel } = sidePanel
    await expect(rowNamed(panel, 'fixture_cookie')).toHaveCount(1)

    await panel.locator('#filter').fill('second')

    await expect(rows(panel)).toHaveCount(1)
    await expect(rows(panel).first()).toContainText('second_cookie')
  })

  test('clearing the filter brings every row back', async ({ sidePanel }) => {
    const { panel } = sidePanel
    await panel.locator('#filter').fill('second')
    await expect(rows(panel)).toHaveCount(1)

    await panel.locator('#filter').fill('')

    await expect(rows(panel)).toHaveCount(2)
  })

  test('deleting a cookie removes it from the browser, not just the grid', async ({ sidePanel, serviceWorker, fixtureServer }) => {
    const { panel } = sidePanel
    await expect(rowNamed(panel, 'fixture_cookie')).toHaveCount(1)

    await rowNamed(panel, 'fixture_cookie').locator('.delete').click()

    await expect(rowNamed(panel, 'fixture_cookie')).toHaveCount(0)

    // The grid could lie. Ask the browser directly.
    const remaining = await serviceWorker.evaluate(
      async origin => (await chrome.cookies.getAll({ url: origin })).map(c => c.name),
      fixtureServer.origin
    )
    expect(remaining).not.toContain('fixture_cookie')
    expect(remaining).toContain('second_cookie')
  })
})

test.describe('web storage', () => {
  test('lists localStorage from the page', async ({ sidePanel }) => {
    const { panel } = sidePanel

    await storeTab(panel, 'localStorage').click()

    await expect(rowNamed(panel, 'alpha')).toHaveCount(1)
    await expect(rowNamed(panel, 'beta')).toHaveCount(1)
    await expect(rowNamed(panel, 'gamma')).toHaveCount(1)
    await expect(rowNamed(panel, 'alpha')).toContainText('one')
  })

  test('lists sessionStorage separately from localStorage', async ({ sidePanel }) => {
    const { panel } = sidePanel

    await storeTab(panel, 'sessionStorage').click()

    await expect(rowNamed(panel, 'session-key')).toHaveCount(1)
    await expect(rowNamed(panel, 'alpha')).toHaveCount(0)
  })

  test('deleting a localStorage entry removes it from the page', async ({ sidePanel }) => {
    const { panel, contentPage } = sidePanel
    await storeTab(panel, 'localStorage').click()
    await expect(rowNamed(panel, 'beta')).toHaveCount(1)

    await rowNamed(panel, 'beta').locator('.delete').click()
    await expect(rowNamed(panel, 'beta')).toHaveCount(0)

    // Confirm against the page's own localStorage, not the extension's view.
    expect(await contentPage.evaluate(() => localStorage.getItem('beta'))).toBeNull()
    expect(await contentPage.evaluate(() => localStorage.getItem('alpha'))).toBe('one')
  })

  test('switching back to cookies restores the cookie rows', async ({ sidePanel }) => {
    const { panel } = sidePanel
    await storeTab(panel, 'localStorage').click()
    await expect(rowNamed(panel, 'alpha')).toHaveCount(1)

    await storeTab(panel, 'cookies').click()

    await expect(rowNamed(panel, 'fixture_cookie')).toHaveCount(1)
  })
})

test.describe('health', () => {
  test('renders without logging an error', async ({ sidePanel }) => {
    const { panel } = sidePanel
    const errors = []
    panel.on('console', msg => msg.type() === 'error' && errors.push(msg.text()))
    panel.on('pageerror', err => errors.push(String(err)))

    await storeTab(panel, 'localStorage').click()
    await expect(rowNamed(panel, 'alpha')).toHaveCount(1)
    await storeTab(panel, 'cookies').click()
    await expect(rowNamed(panel, 'fixture_cookie')).toHaveCount(1)

    expect(errors).toEqual([])
  })
})
