import { describe, it, expect, beforeEach } from 'vitest'
import { createChromeMock } from '../helpers/chrome-mock.mjs'
import { getCookies, setCookie, deleteCookie } from '../../storage/cookies.js'

/**
 * storage/cookies.js is the security-sensitive edge of this extension: it is
 * the only place that writes cookies back to the browser, and the cookie
 * prefix rules it enforces are what stop a written cookie from being silently
 * rejected or, worse, widened.
 */
let chrome

beforeEach(() => {
  chrome = createChromeMock()
  globalThis.chrome = chrome
})

const detailsOf = call => call[0]

describe('setCookie - __Host- prefix rules', () => {
  it('drops the domain, forces path=/ and forces secure', async () => {
    await setCookie({
      url: 'https://example.com/app',
      name: '__Host-session',
      value: 'abc',
      domain: '.example.com',
      path: '/app',
      secure: false
    })

    const details = detailsOf(chrome.cookies.set.calls[0])
    expect(details).not.toHaveProperty('domain')
    expect(details.path).toBe('/')
    expect(details.secure).toBe(true)
  })

  it('applies the rules even when the caller supplied nothing to override', async () => {
    await setCookie({ url: 'https://example.com/', name: '__Host-a', value: '1' })

    const details = detailsOf(chrome.cookies.set.calls[0])
    expect(details.path).toBe('/')
    expect(details.secure).toBe(true)
  })
})

describe('setCookie - __Secure- prefix rules', () => {
  it('forces secure but leaves the domain and path alone', async () => {
    await setCookie({
      url: 'https://example.com/app',
      name: '__Secure-token',
      value: 'xyz',
      domain: '.example.com',
      path: '/app',
      secure: false
    })

    const details = detailsOf(chrome.cookies.set.calls[0])
    expect(details.secure).toBe(true)
    expect(details.domain).toBe('.example.com')
    expect(details.path).toBe('/app')
  })
})

describe('setCookie - ordinary cookies', () => {
  it('passes an ordinary cookie through untouched', async () => {
    const raw = {
      url: 'http://example.com/',
      name: 'plain',
      value: 'v',
      domain: 'example.com',
      path: '/',
      secure: false,
      httpOnly: true,
      sameSite: 'lax'
    }

    await setCookie(raw)

    expect(detailsOf(chrome.cookies.set.calls[0])).toMatchObject(raw)
  })

  it('strips undefined fields rather than sending them explicitly', async () => {
    // chrome.cookies.set rejects keys present with an undefined value, so the
    // difference between "absent" and "undefined" is load-bearing here.
    await setCookie({ url: 'https://example.com/', name: 'a', value: '1' })

    const details = detailsOf(chrome.cookies.set.calls[0])
    for (const key of ['domain', 'path', 'secure', 'httpOnly', 'sameSite', 'expirationDate', 'storeId', 'partitionKey']) {
      expect(Object.prototype.hasOwnProperty.call(details, key)).toBe(false)
    }
  })

  it('never forwards a field the chrome API does not accept', async () => {
    await setCookie({
      url: 'https://example.com/',
      name: 'a',
      value: '1',
      session: true,
      hostOnly: true,
      unexpected: 'nope'
    })

    const details = detailsOf(chrome.cookies.set.calls[0])
    expect(details).not.toHaveProperty('session')
    expect(details).not.toHaveProperty('hostOnly')
    expect(details).not.toHaveProperty('unexpected')
  })

  it('keeps a partitioned cookie partitioned', async () => {
    const partitionKey = { topLevelSite: 'https://top.example', hasCrossSiteAncestor: true }

    await setCookie({ url: 'https://example.com/', name: 'a', value: '1', partitionKey })

    expect(detailsOf(chrome.cookies.set.calls[0]).partitionKey).toEqual(partitionKey)
  })

  it('treats a false secure flag as a value, not as absent', async () => {
    await setCookie({ url: 'http://example.com/', name: 'a', value: '1', secure: false })

    expect(detailsOf(chrome.cookies.set.calls[0]).secure).toBe(false)
  })

  it('tolerates a cookie with no name', async () => {
    await expect(setCookie({ url: 'https://example.com/', value: '1' })).resolves.toBeDefined()
  })
})

describe('deleteCookie', () => {
  it('sends only the fields chrome.cookies.remove accepts', async () => {
    await deleteCookie({
      url: 'https://example.com/',
      name: 'a',
      value: 'ignored',
      domain: 'example.com',
      storeId: '0'
    })

    const details = detailsOf(chrome.cookies.remove.calls[0])
    expect(details).toEqual({ url: 'https://example.com/', name: 'a', storeId: '0' })
  })

  it('omits storeId and partitionKey when they are absent', async () => {
    await deleteCookie({ url: 'https://example.com/', name: 'a' })

    expect(detailsOf(chrome.cookies.remove.calls[0])).toEqual({
      url: 'https://example.com/',
      name: 'a'
    })
  })

  it('preserves the partition key so a partitioned cookie is actually removed', async () => {
    const partitionKey = { topLevelSite: 'https://top.example' }

    await deleteCookie({ url: 'https://example.com/', name: 'a', partitionKey })

    expect(detailsOf(chrome.cookies.remove.calls[0]).partitionKey).toEqual(partitionKey)
  })
})

describe('getCookies', () => {
  it('queries by url', async () => {
    chrome.cookies.getAll.setImpl(async () => [{ name: 'a' }])

    const result = await getCookies('https://example.com/')

    expect(chrome.cookies.getAll.calls[0][0]).toEqual({ url: 'https://example.com/' })
    expect(result).toEqual([{ name: 'a' }])
  })
})
