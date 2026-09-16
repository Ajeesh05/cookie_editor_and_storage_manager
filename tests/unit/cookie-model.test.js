import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  normalizeCookieDomainForIdentity,
  normalizeCookiePathForIdentity,
  getPartitionKeySignature,
  buildCookieIdentity,
  isSameCookieIdentity,
  makeCookieId,
  buildCookieUrl,
  normalizeSameSite,
  resolveExpirationDate,
  buildCookieSetDetails,
  buildCookieDeleteDetails,
  getRowPrimaryField,
  getHostFromUrl,
  hashString,
  buildRowToken,
  buildStoreSignature,
  normalizeStorageItems,
  normalizeCookieItems,
  normalizeExportPreferences,
  getStorageTypeLabel,
  isStorageType,
  parseSelectedTypes,
  readImportPayload,
  summarizeOutcomes,
  describeFailures,
  makeSnapshotFileName
} from '../../lib/cookie-model.js'

const TAB = { id: 1, url: 'https://www.example.com/app/page?q=1' }

afterEach(() => {
  vi.useRealTimers()
})

describe('cookie identity', () => {
  it('treats a leading dot as the same domain', () => {
    expect(normalizeCookieDomainForIdentity('.example.com')).toBe('example.com')
  })

  it('is case insensitive about the domain', () => {
    expect(normalizeCookieDomainForIdentity('Example.COM')).toBe('example.com')
  })

  it('defaults a missing path to root', () => {
    expect(normalizeCookiePathForIdentity(undefined)).toBe('/')
  })

  it('rejects a path that does not start with a slash', () => {
    expect(normalizeCookiePathForIdentity('app')).toBe('/')
  })

  it('considers .example.com and example.com the same cookie', () => {
    const a = buildCookieIdentity({ name: 'sid', domain: '.example.com', path: '/' })
    const b = buildCookieIdentity({ name: 'sid', domain: 'example.com', path: '/' })

    expect(isSameCookieIdentity(a, b)).toBe(true)
  })

  it('considers different paths different cookies', () => {
    const a = buildCookieIdentity({ name: 'sid', domain: 'example.com', path: '/' })
    const b = buildCookieIdentity({ name: 'sid', domain: 'example.com', path: '/admin' })

    expect(isSameCookieIdentity(a, b)).toBe(false)
  })

  it('separates cookies in different partitions', () => {
    const a = buildCookieIdentity({ name: 'sid', domain: 'e.com', partitionKey: { topLevelSite: 'https://a.test' } })
    const b = buildCookieIdentity({ name: 'sid', domain: 'e.com', partitionKey: { topLevelSite: 'https://b.test' } })

    expect(isSameCookieIdentity(a, b)).toBe(false)
  })

  it('separates cookies in different cookie stores', () => {
    const a = buildCookieIdentity({ name: 'sid', domain: 'e.com', storeId: '0' })
    const b = buildCookieIdentity({ name: 'sid', domain: 'e.com', storeId: '1' })

    expect(isSameCookieIdentity(a, b)).toBe(false)
  })

  it('survives a completely empty cookie', () => {
    expect(buildCookieIdentity(undefined)).toEqual({
      name: '',
      domain: '',
      path: '/',
      storeId: '',
      partition: ''
    })
  })

  it('distinguishes a cross-site ancestor partition from a same-site one', () => {
    const withAncestor = getPartitionKeySignature({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: true })
    const without = getPartitionKeySignature({ topLevelSite: 'https://a.test', hasCrossSiteAncestor: false })

    expect(withAncestor).not.toBe(without)
  })

  it('treats a non-object partition key as no partition', () => {
    expect(getPartitionKeySignature('nonsense')).toBe('')
  })

  it('gives identical cookies the same id and different cookies different ids', () => {
    const base = { name: 'sid', domain: '.example.com', path: '/', storeId: '0' }

    expect(makeCookieId(base)).toBe(makeCookieId({ ...base, domain: 'example.com' }))
    expect(makeCookieId(base)).not.toBe(makeCookieId({ ...base, name: 'other' }))
  })
})

describe('buildCookieUrl', () => {
  it('uses https for a secure cookie', () => {
    expect(buildCookieUrl({ domain: 'example.com', path: '/', secure: true }, TAB.url))
      .toBe('https://example.com/')
  })

  it('uses http for an insecure cookie', () => {
    expect(buildCookieUrl({ domain: 'example.com', path: '/', secure: false }, TAB.url))
      .toBe('http://example.com/')
  })

  it('strips the leading dot from a domain cookie', () => {
    expect(buildCookieUrl({ domain: '.example.com', path: '/', secure: true }, TAB.url))
      .toBe('https://example.com/')
  })

  it('falls back to the tab hostname for a host-only cookie', () => {
    expect(buildCookieUrl({ path: '/', secure: true }, TAB.url))
      .toBe('https://www.example.com/')
  })

  it('normalises a path with no leading slash', () => {
    expect(buildCookieUrl({ domain: 'example.com', path: 'app', secure: true }, TAB.url))
      .toBe('https://example.com/')
  })

  it('preserves a real sub-path', () => {
    expect(buildCookieUrl({ domain: 'example.com', path: '/admin', secure: true }, TAB.url))
      .toBe('https://example.com/admin')
  })

  it('returns the fallback unchanged when it is not a valid URL', () => {
    expect(buildCookieUrl({ domain: 'example.com' }, 'not-a-url')).toBe('not-a-url')
  })
})

describe('normalizeSameSite', () => {
  it.each([
    ['none', 'no_restriction'],
    ['None', 'no_restriction'],
    ['no_restriction', 'no_restriction'],
    ['lax', 'lax'],
    ['Lax', 'lax'],
    ['strict', 'strict'],
    ['STRICT', 'strict']
  ])('maps %s to %s', (input, expected) => {
    expect(normalizeSameSite(input)).toBe(expected)
  })

  it.each([undefined, null, '', 'unspecified', 'garbage'])('returns undefined for %s', input => {
    expect(normalizeSameSite(input)).toBeUndefined()
  })
})

describe('resolveExpirationDate', () => {
  it('keeps the explicit expiration when no maxAge is given', () => {
    expect(resolveExpirationDate({ expirationDate: 1234, maxAge: '' })).toBe(1234)
  })

  it('leaves a session cookie as a session cookie', () => {
    expect(resolveExpirationDate({ maxAge: undefined })).toBeUndefined()
  })

  it('converts maxAge into an absolute timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    const expected = Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 3600
    expect(resolveExpirationDate({ maxAge: 3600 })).toBe(expected)
  })

  it('accepts maxAge as a numeric string', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))

    expect(resolveExpirationDate({ maxAge: '60' })).toBe(
      Math.floor(Date.parse('2026-01-01T00:00:00Z') / 1000) + 60
    )
  })

  it('falls back to the explicit expiration when maxAge is not a number', () => {
    expect(resolveExpirationDate({ maxAge: 'soon', expirationDate: 42 })).toBe(42)
  })
})

describe('buildCookieSetDetails', () => {
  it('coerces the value to a string and defaults the path', () => {
    const details = buildCookieSetDetails(TAB, { name: 'a', value: 12345 })

    expect(details.value).toBe('12345')
    expect(details.path).toBe('/')
    expect(details.url).toBe(TAB.url)
  })

  it('coerces missing flags to false rather than leaving them undefined', () => {
    const details = buildCookieSetDetails(TAB, { name: 'a' })

    expect(details.secure).toBe(false)
    expect(details.httpOnly).toBe(false)
    expect(details.value).toBe('')
  })

  it('normalises sameSite on the way through', () => {
    expect(buildCookieSetDetails(TAB, { name: 'a', sameSite: 'None' }).sameSite).toBe('no_restriction')
  })
})

describe('buildCookieDeleteDetails', () => {
  it('addresses the cookie by its own url, not the tab url', () => {
    const details = buildCookieDeleteDetails(TAB, {
      name: 'sid',
      domain: '.other.example',
      path: '/admin',
      secure: true
    })

    expect(details.url).toBe('https://other.example/admin')
    expect(details.name).toBe('sid')
  })
})

describe('web storage normalisation', () => {
  it('drops entries with a blank or whitespace-only key', () => {
    const rows = normalizeStorageItems([
      { key: 'a', value: '1' },
      { key: '   ', value: '2' },
      { key: '', value: '3' }
    ])

    expect(rows).toEqual([{ key: 'a', value: '1' }])
  })

  it('trims surrounding whitespace from keys', () => {
    expect(normalizeStorageItems([{ key: '  spaced  ', value: 'v' }])).toEqual([{ key: 'spaced', value: 'v' }])
  })

  it('keeps the last value when a key repeats', () => {
    expect(normalizeStorageItems([{ key: 'a', value: 'first' }, { key: 'a', value: 'second' }]))
      .toEqual([{ key: 'a', value: 'second' }])
  })

  it('coerces non-string values', () => {
    expect(normalizeStorageItems([{ key: 'a', value: 7 }])).toEqual([{ key: 'a', value: '7' }])
  })

  it('returns an empty list for anything that is not an array', () => {
    expect(normalizeStorageItems(null)).toEqual([])
    expect(normalizeStorageItems('nope')).toEqual([])
  })

  it('skips non-object rows', () => {
    expect(normalizeStorageItems([null, 'x', 5, { key: 'a', value: '1' }]))
      .toEqual([{ key: 'a', value: '1' }])
  })
})

describe('cookie import normalisation', () => {
  it('drops cookies with no name', () => {
    expect(normalizeCookieItems([{ name: '  ' }, { value: 'x' }])).toEqual([])
  })

  it('defaults the path and coerces the flags', () => {
    const [cookie] = normalizeCookieItems([{ name: 'a' }])

    expect(cookie).toMatchObject({ name: 'a', value: '', path: '/', secure: false, httpOnly: false })
  })

  it('keeps a numeric expiration and discards a non-numeric one', () => {
    expect(normalizeCookieItems([{ name: 'a', expirationDate: 1700000000 }])[0].expirationDate).toBe(1700000000)
    expect(normalizeCookieItems([{ name: 'a', expirationDate: 'later' }])[0].expirationDate).toBeUndefined()
  })

  it('discards a partition key that is not an object', () => {
    expect(normalizeCookieItems([{ name: 'a', partitionKey: 'x' }])[0].partitionKey).toBeUndefined()
  })
})

describe('change detection', () => {
  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'))
    expect(hashString('abc')).not.toBe(hashString('abd'))
  })

  it('produces the same signature regardless of row order', () => {
    const rows = [{ key: 'a', value: '1' }, { key: 'b', value: '2' }]

    expect(buildStoreSignature('localStorage', TAB, rows))
      .toBe(buildStoreSignature('localStorage', TAB, [...rows].reverse()))
  })

  it('changes the signature when a value changes', () => {
    const before = buildStoreSignature('localStorage', TAB, [{ key: 'a', value: '1' }])
    const after = buildStoreSignature('localStorage', TAB, [{ key: 'a', value: '2' }])

    expect(before).not.toBe(after)
  })

  it('includes cookie flags in the row token so a secure toggle is noticed', () => {
    const cookie = { name: 'a', domain: 'e.com', path: '/', value: 'v' }

    expect(buildRowToken('cookies', { ...cookie, secure: true }))
      .not.toBe(buildRowToken('cookies', { ...cookie, secure: false }))
  })
})

describe('import payload parsing', () => {
  const valid = { cookies: [{ name: 'a', value: '1' }] }

  it('rejects malformed JSON with a readable message', () => {
    expect(() => readImportPayload('{ not json')).toThrow(/Invalid JSON/)
  })

  it('accepts a bare object', () => {
    expect(readImportPayload(JSON.stringify(valid)).includedTypes).toEqual(['cookies'])
  })

  it('unwraps a { payload: ... } envelope', () => {
    expect(readImportPayload(JSON.stringify({ payload: valid })).includedTypes).toEqual(['cookies'])
  })

  it('rejects a file containing none of the three storage types', () => {
    expect(() => readImportPayload(JSON.stringify({ somethingElse: [] })))
      .toThrow(/does not contain cookies/)
  })

  it('rejects a storage type whose value is not an array', () => {
    expect(() => readImportPayload(JSON.stringify({ cookies: 'nope' })))
      .toThrow(/invalid cookies format/)
  })

  it('names the offending index when a cookie has no name', () => {
    expect(() => readImportPayload(JSON.stringify({ cookies: [{ name: 'ok' }, { value: 'x' }] })))
      .toThrow(/index 1/)
  })

  it('names the offending index when a storage entry has no key', () => {
    expect(() => readImportPayload(JSON.stringify({ localStorage: [{ key: 'a' }, { value: 'x' }] })))
      .toThrow(/index 1/)
  })

  it('honours explicit selectedTypes metadata', () => {
    const text = JSON.stringify({ selectedTypes: ['localStorage'], localStorage: [{ key: 'a', value: '1' }], cookies: [] })

    expect(readImportPayload(text).includedTypes).toEqual(['localStorage'])
  })

  it('rejects an unsupported selectedTypes entry', () => {
    expect(() => readImportPayload(JSON.stringify({ selectedTypes: ['indexedDB'], cookies: [] })))
      .toThrow(/unsupported storage type/)
  })

  it('normalises the parsed rows on the way out', () => {
    const payload = readImportPayload(JSON.stringify({ localStorage: [{ key: '  a  ', value: 2 }] }))

    expect(payload.localStorage).toEqual([{ key: 'a', value: '2' }])
  })

  it('returns empty arrays for types the file did not include', () => {
    const payload = readImportPayload(JSON.stringify(valid))

    expect(payload.localStorage).toEqual([])
    expect(payload.sessionStorage).toEqual([])
  })
})

describe('parseSelectedTypes', () => {
  it('returns null when the metadata is absent', () => {
    expect(parseSelectedTypes(undefined)).toBeNull()
  })

  it('throws when the metadata is not an array', () => {
    expect(() => parseSelectedTypes('cookies')).toThrow(/invalid selectedTypes/)
  })

  it('de-duplicates repeated entries', () => {
    expect(parseSelectedTypes(['cookies', 'cookies'])).toEqual(['cookies'])
  })

  it('throws on an empty selection', () => {
    expect(() => parseSelectedTypes([])).toThrow(/selected no storage types/)
  })

  it('recognises exactly the three supported types', () => {
    expect(isStorageType('cookies')).toBe(true)
    expect(isStorageType('indexedDB')).toBe(false)
  })
})

describe('export preferences', () => {
  it('defaults every type to selected', () => {
    expect(normalizeExportPreferences(undefined))
      .toEqual({ cookies: true, localStorage: true, sessionStorage: true })
  })

  it('preserves an explicit false', () => {
    expect(normalizeExportPreferences({ cookies: false }))
      .toEqual({ cookies: false, localStorage: true, sessionStorage: true })
  })

  it('coerces non-boolean values', () => {
    expect(normalizeExportPreferences({ cookies: 0, localStorage: 'yes' }))
      .toMatchObject({ cookies: false, localStorage: true })
  })
})

describe('presentation helpers', () => {
  it('labels each storage type for display', () => {
    expect(getStorageTypeLabel('cookies')).toBe('cookies')
    expect(getStorageTypeLabel('localStorage')).toBe('local storage')
    expect(getStorageTypeLabel('sessionStorage')).toBe('session storage')
  })

  it('passes an unknown type through unchanged', () => {
    expect(getStorageTypeLabel('whatever')).toBe('whatever')
  })

  it('strips www from the displayed host', () => {
    expect(getHostFromUrl('https://www.example.com/x')).toBe('example.com')
  })

  it('returns an empty host for an unparseable url', () => {
    expect(getHostFromUrl('not a url')).toBe('')
    expect(getHostFromUrl('')).toBe('')
  })

  it('reports the chrome:// pseudo-host as-is', () => {
    // chrome://newtab parses, so the host renders as "newtab" rather than
    // blank. Worth pinning: it is what the side panel shows on a chrome:// tab.
    expect(getHostFromUrl('chrome://newtab')).toBe('newtab')
  })

  it('prefers a cookie name over a storage key for the primary field', () => {
    expect(getRowPrimaryField({ name: 'n', key: 'k' })).toBe('n')
    expect(getRowPrimaryField({ key: 'k' })).toBe('k')
    expect(getRowPrimaryField({})).toBe('')
  })

  it('builds a snapshot filename from the host and a filesystem-safe timestamp', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-03-04T05:06:07.008Z'))

    const name = makeSnapshotFileName(TAB)

    expect(name).toMatch(/^storage-control-example\.com-/)
    expect(name.endsWith('.json')).toBe(true)
    expect(name).not.toMatch(/[:]/)
  })

  it('falls back to "site" when the host cannot be determined', () => {
    expect(makeSnapshotFileName({ url: 'about:blank' })).toMatch(/^storage-control-site-/)
  })
})

describe('bulk outcome reporting', () => {
  it('counts successes and collects failures', () => {
    const summary = summarizeOutcomes([
      { ok: true },
      { ok: false, label: 'a', error: 'boom' },
      { ok: true }
    ])

    expect(summary.applied).toBe(2)
    expect(summary.failed).toEqual([{ label: 'a', error: 'boom' }])
  })

  it('reports an all-clear as no failures', () => {
    expect(summarizeOutcomes([{ ok: true }])).toEqual({ applied: 1, failed: [] })
  })

  it('lists the first few failures and counts the rest', () => {
    const failed = ['a', 'b', 'c', 'd', 'e'].map(label => ({ label, error: 'x' }))

    const text = describeFailures(failed)

    expect(text).toContain('a: x')
    expect(text).toContain('c: x')
    expect(text).not.toContain('d: x')
    expect(text).toContain('+2 more')
  })

  it('names an unlabelled failure rather than printing undefined', () => {
    expect(describeFailures([{ error: 'x' }])).toContain('(unnamed)')
  })
})
