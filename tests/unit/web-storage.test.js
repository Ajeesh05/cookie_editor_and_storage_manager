import { describe, it, expect, beforeEach } from 'vitest'
import { createChromeMock } from '../helpers/chrome-mock.mjs'
import { FakeStorage } from '../helpers/fake-storage.js'
import {
  listWebStorage,
  setWebStorageItem,
  deleteWebStorageItem,
  deleteManyWebStorageItems
} from '../../storage/webStorage.js'

/**
 * These functions do their real work inside a callback handed to
 * chrome.scripting.executeScript, which Chrome serialises and runs in the
 * page. The chrome mock invokes that callback directly against a fake Storage,
 * so the injected logic is exercised without a browser.
 */
const TAB_ID = 42
let chrome
let local
let session

beforeEach(() => {
  chrome = createChromeMock()
  globalThis.chrome = chrome
  local = new FakeStorage()
  session = new FakeStorage()
  globalThis.window = { localStorage: local, sessionStorage: session }
})

describe('listWebStorage', () => {
  it('returns entries sorted by key', async () => {
    local.setItem('zebra', '1')
    local.setItem('apple', '2')
    local.setItem('mango', '3')

    const rows = await listWebStorage(TAB_ID, 'localStorage')

    expect(rows.map(r => r.key)).toEqual(['apple', 'mango', 'zebra'])
  })

  it('reads session storage when asked for it', async () => {
    session.setItem('s', 'from-session')
    local.setItem('l', 'from-local')

    const rows = await listWebStorage(TAB_ID, 'sessionStorage')

    expect(rows).toEqual([{ key: 's', value: 'from-session' }])
  })

  it('returns an empty list for empty storage', async () => {
    expect(await listWebStorage(TAB_ID, 'localStorage')).toEqual([])
  })

  it('runs against the requested tab', async () => {
    await listWebStorage(TAB_ID, 'localStorage')

    expect(chrome.scripting.executeScript.calls[0][0].target).toEqual({ tabId: TAB_ID })
  })
})

describe('setWebStorageItem', () => {
  it('writes a new entry', async () => {
    const result = await setWebStorageItem(TAB_ID, { area: 'localStorage', key: 'a', value: '1' })

    expect(local.getItem('a')).toBe('1')
    expect(result).toEqual({ ok: true, key: 'a' })
  })

  it('trims whitespace around the key', async () => {
    await setWebStorageItem(TAB_ID, { area: 'localStorage', key: '  spaced  ', value: 'v' })

    expect(local.getItem('spaced')).toBe('v')
  })

  it('removes the old key when an entry is renamed', async () => {
    local.setItem('old', 'v')

    await setWebStorageItem(TAB_ID, { area: 'localStorage', key: 'new', value: 'v', previousKey: 'old' })

    expect(local.getItem('old')).toBeNull()
    expect(local.getItem('new')).toBe('v')
  })

  it('does not delete the entry when the key is unchanged', async () => {
    local.setItem('same', 'before')

    await setWebStorageItem(TAB_ID, { area: 'localStorage', key: 'same', value: 'after', previousKey: 'same' })

    expect(local.getItem('same')).toBe('after')
  })

  it('rejects a blank key', async () => {
    await expect(setWebStorageItem(TAB_ID, { area: 'localStorage', key: '   ', value: 'v' }))
      .rejects.toThrow(/Key is required/)
  })

  it('stores an empty value rather than dropping the entry', async () => {
    await setWebStorageItem(TAB_ID, { area: 'localStorage', key: 'a', value: '' })

    expect(local.getItem('a')).toBe('')
  })

  it('coerces a non-string value', async () => {
    await setWebStorageItem(TAB_ID, { area: 'localStorage', key: 'a', value: 99 })

    expect(local.getItem('a')).toBe('99')
  })

  it('writes to session storage when asked', async () => {
    await setWebStorageItem(TAB_ID, { area: 'sessionStorage', key: 'a', value: '1' })

    expect(session.getItem('a')).toBe('1')
    expect(local.getItem('a')).toBeNull()
  })
})

describe('deleteWebStorageItem', () => {
  it('removes the entry', async () => {
    local.setItem('a', '1')

    const result = await deleteWebStorageItem(TAB_ID, { area: 'localStorage', key: 'a' })

    expect(local.getItem('a')).toBeNull()
    expect(result).toEqual({ ok: true })
  })

  it('is a no-op for a key that is not there', async () => {
    await expect(deleteWebStorageItem(TAB_ID, { area: 'localStorage', key: 'ghost' }))
      .resolves.toEqual({ ok: true })
  })
})

describe('deleteManyWebStorageItems', () => {
  it('removes every listed key and reports the count', async () => {
    local.setItem('a', '1')
    local.setItem('b', '2')
    local.setItem('c', '3')

    const result = await deleteManyWebStorageItems(TAB_ID, { area: 'localStorage', keys: ['a', 'c'] })

    expect(local.getItem('a')).toBeNull()
    expect(local.getItem('b')).toBe('2')
    expect(local.getItem('c')).toBeNull()
    expect(result).toEqual({ ok: true, deleted: 2 })
  })

  it('handles a missing keys list without throwing', async () => {
    await expect(deleteManyWebStorageItems(TAB_ID, { area: 'localStorage' }))
      .resolves.toEqual({ ok: true, deleted: 0 })
  })
})
