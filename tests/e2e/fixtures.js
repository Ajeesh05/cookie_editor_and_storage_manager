import { test as base, chromium } from '@playwright/test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer } from 'node:http'
import { packDir } from '../helpers/pack.mjs'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

const FIXTURE_HTML = `<!doctype html>
<meta charset="utf-8">
<title>Storage fixture</title>
<h1>Storage fixture</h1>
<script>
  localStorage.setItem('alpha', 'one')
  localStorage.setItem('beta', 'two')
  localStorage.setItem('gamma', 'three')
  sessionStorage.setItem('session-key', 'session-value')
  document.cookie = 'fixture_cookie=cookie-value; path=/'
  document.cookie = 'second_cookie=another; path=/'
</script>`

/**
 * A real http origin, because chrome.cookies and chrome.scripting do not apply
 * to file:// pages - the extension would have nothing to read.
 */
async function startFixtureServer() {
  const server = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(FIXTURE_HTML)
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  const { port } = server.address()
  return { server, origin: `http://127.0.0.1:${port}` }
}

export const test = base.extend({
  fixtureServer: async ({}, use) => {
    const started = await startFixtureServer()
    await use(started)
    // Chromium holds the connection open with keep-alive, and server.close()
    // waits for in-flight sockets - so without this the teardown hangs until
    // the test times out.
    started.server.closeAllConnections()
    await new Promise(resolve => started.server.close(resolve))
  },

  context: async ({}, use) => {
    const workDir = mkdtempSync(join(tmpdir(), 'cookie-editor-e2e-'))
    const extensionDir = join(workDir, 'extension')
    packDir(REPO_ROOT, extensionDir)

    const context = await chromium.launchPersistentContext(join(workDir, 'profile'), {
      channel: 'chromium',
      args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`]
    })

    await use(context)

    await context.close()
    rmSync(workDir, { recursive: true, force: true })
  },

  serviceWorker: async ({ context }, use) => {
    let [worker] = context.serviceWorkers()
    if (!worker) worker = await context.waitForEvent('serviceworker')
    await use(worker)
  },

  extensionId: async ({ serviceWorker }, use) => {
    await use(new URL(serviceWorker.url()).host)
  },

  /**
   * Opens the fixture page, then opens sidepanel.html as a normal tab with one
   * seam stubbed: chrome.tabs.query.
   *
   * In production the side panel is attached to a browser window, so
   * {active: true, currentWindow: true} resolves to the content tab the user is
   * looking at. Opened as a tab it would resolve to itself, and the panel would
   * inspect its own chrome-extension:// origin. Pinning that one call restores
   * production behaviour; everything downstream stays real - the actual service
   * worker, real chrome.cookies, real chrome.scripting injection into the
   * fixture page, and the real grid rendering.
   */
  sidePanel: async ({ context, serviceWorker, extensionId, fixtureServer }, use) => {
    const contentPage = await context.newPage()
    await contentPage.goto(fixtureServer.origin)

    const tab = await serviceWorker.evaluate(async origin => {
      const [found] = await chrome.tabs.query({ url: `${origin}/*` })
      return { id: found.id, url: found.url, windowId: found.windowId }
    }, fixtureServer.origin)

    const panel = await context.newPage()
    await panel.addInitScript(target => {
      const pin = () => {
        if (!globalThis.chrome?.tabs) return false
        chrome.tabs.query = async () => [target]
        return true
      }
      if (!pin()) {
        Object.defineProperty(globalThis, 'chrome', {
          configurable: true,
          set(value) {
            delete globalThis.chrome
            globalThis.chrome = value
            pin()
          }
        })
      }
    }, tab)

    await panel.goto(`chrome-extension://${extensionId}/sidepanel.html`)
    await use({ panel, contentPage, tab })
  }
})

export const expect = test.expect
