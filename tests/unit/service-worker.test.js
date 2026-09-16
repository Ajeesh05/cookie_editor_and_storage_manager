import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createChromeMock } from '../helpers/chrome-mock.mjs'
import { FakeStorage } from '../helpers/fake-storage.js'

/**
 * service-worker.js registers its listeners at import time, so the chrome
 * global has to exist before the module is loaded - hence the dynamic import
 * and resetModules in beforeEach.
 */
let chrome
let sw

beforeEach(async () => {
  chrome = createChromeMock()
  globalThis.chrome = chrome
  globalThis.window = { localStorage: new FakeStorage(), sessionStorage: new FakeStorage() }
  vi.resetModules()
  sw = await import('../../service-worker.js')
})

/** Fire the message listener and resolve with whatever it sends back. */
function sendMessage(msg) {
  return new Promise(resolve => {
    chrome.runtime.onMessage.emit(msg, { tab: { id: 1 } }, resolve)
  })
}

describe('handleMessage routing', () => {
  it('routes COOKIES_LIST to the cookies API', async () => {
    chrome.cookies.getAll.setImpl(async () => [{ name: 'a' }])

    const result = await sw.handleMessage({ type: 'COOKIES_LIST', url: 'https://example.com/' })

    expect(chrome.cookies.getAll.calls[0][0]).toEqual({ url: 'https://example.com/' })
    expect(result).toEqual([{ name: 'a' }])
  })

  it('routes COOKIE_SET', async () => {
    await sw.handleMessage({ type: 'COOKIE_SET', details: { url: 'https://e.com/', name: 'a', value: '1' } })

    expect(chrome.cookies.set.calls).toHaveLength(1)
  })

  it('routes COOKIE_DELETE', async () => {
    await sw.handleMessage({ type: 'COOKIE_DELETE', details: { url: 'https://e.com/', name: 'a' } })

    expect(chrome.cookies.remove.calls).toHaveLength(1)
  })

  it('routes WEB_STORAGE_LIST with the tab id', async () => {
    await sw.handleMessage({ type: 'WEB_STORAGE_LIST', tabId: 7, area: 'localStorage' })

    expect(chrome.scripting.executeScript.calls[0][0].target).toEqual({ tabId: 7 })
  })

  it('routes WEB_STORAGE_SET', async () => {
    const result = await sw.handleMessage({
      type: 'WEB_STORAGE_SET',
      tabId: 7,
      details: { area: 'localStorage', key: 'a', value: '1' }
    })

    expect(result).toEqual({ ok: true, key: 'a' })
  })

  it('routes WEB_STORAGE_DELETE', async () => {
    const result = await sw.handleMessage({
      type: 'WEB_STORAGE_DELETE',
      tabId: 7,
      details: { area: 'localStorage', key: 'a' }
    })

    expect(result).toEqual({ ok: true })
  })

  it('routes WEB_STORAGE_BULK_DELETE', async () => {
    const result = await sw.handleMessage({
      type: 'WEB_STORAGE_BULK_DELETE',
      tabId: 7,
      details: { area: 'localStorage', keys: ['a', 'b'] }
    })

    expect(result).toEqual({ ok: true, deleted: 2 })
  })

  it('rejects an unknown message type and names it', async () => {
    await expect(sw.handleMessage({ type: 'DROP_DATABASE' }))
      .rejects.toThrow(/Unsupported message type: DROP_DATABASE/)
  })
})

describe('onMessage listener contract', () => {
  it('wraps a result as { ok: true }', async () => {
    chrome.cookies.getAll.setImpl(async () => [{ name: 'a' }])

    expect(await sendMessage({ type: 'COOKIES_LIST', url: 'https://e.com/' }))
      .toEqual({ ok: true, result: [{ name: 'a' }] })
  })

  it('wraps a failure as { ok: false } with the message', async () => {
    const response = await sendMessage({ type: 'NOPE' })

    expect(response.ok).toBe(false)
    expect(response.error).toMatch(/Unsupported message type: NOPE/)
  })

  it('reports a thrown chrome API error rather than hanging', async () => {
    chrome.cookies.getAll.setImpl(async () => {
      throw new Error('no host permission')
    })

    const response = await sendMessage({ type: 'COOKIES_LIST', url: 'https://e.com/' })

    expect(response).toEqual({ ok: false, error: 'no host permission' })
  })

  it('returns true so the async response channel stays open', async () => {
    // Without this, MV3 closes the channel before sendResponse fires and the
    // side panel would see every reply as undefined.
    const [returned] = await chrome.runtime.onMessage.emit({ type: 'COOKIES_LIST', url: 'https://e.com/' }, {}, () => {})

    expect(returned).toBe(true)
  })
})

describe('toolbar action', () => {
  it('opens the side panel for the clicked window', async () => {
    await chrome.action.onClicked.emit({ windowId: 5 })

    expect(chrome.sidePanel.open.calls[0][0]).toEqual({ windowId: 5 })
  })

  it('does nothing when the tab has no window', async () => {
    await chrome.action.onClicked.emit({})

    expect(chrome.sidePanel.open.calls).toHaveLength(0)
  })

  it('survives the side panel refusing to open', async () => {
    chrome.sidePanel.open.setImpl(async () => {
      throw new Error('user gesture required')
    })

    await expect(chrome.action.onClicked.emit({ windowId: 5 })).resolves.toBeDefined()
  })
})

describe('first run', () => {
  it('opens the guide on install', async () => {
    await chrome.runtime.onInstalled.emit({ reason: 'install' })

    expect(chrome.tabs.create.calls[0][0].url).toContain('guide.html')
  })

  it('does not reopen the guide on update', async () => {
    await chrome.runtime.onInstalled.emit({ reason: 'update' })

    expect(chrome.tabs.create.calls).toHaveLength(0)
  })
})
