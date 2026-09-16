import { StorageGrid } from './ui/grid.js'
import { showContextMenu } from './ui/contextMenu.js'

const table = document.getElementById("table")
const refreshIconBtn = document.getElementById("refreshIcon")
const deleteAllBtn = document.getElementById("deleteAll")
const filterInput = document.getElementById("filter")
const createFab = document.getElementById("createFab")
const importBtn = document.getElementById("importBtn")
const exportMenuWrap = document.getElementById("exportMenuWrap")
const exportBtn = document.getElementById("exportBtn")
const exportToggleBtn = document.getElementById("exportToggle")
const exportMenu = document.getElementById("exportMenu")
const exportCookiesCheckbox = document.getElementById("exportCookies")
const exportLocalStorageCheckbox = document.getElementById("exportLocalStorage")
const exportSessionStorageCheckbox = document.getElementById("exportSessionStorage")
const importFileInput = document.getElementById("importFile")
const confirmOverlay = document.getElementById("confirmOverlay")
const confirmMessage = document.getElementById("confirmMessage")
const confirmCancelBtn = document.getElementById("confirmCancel")
const confirmDeleteBtn = document.getElementById("confirmDelete")
const alertOverlay = document.getElementById("alertOverlay")
const alertMessage = document.getElementById("alertMessage")
const alertOkBtn = document.getElementById("alertOk")
const tabButtons = Array.from(document.querySelectorAll('#tabs [data-store]'))

// Ensure modal is always hidden on initial panel render.
confirmOverlay.hidden = true
alertOverlay.hidden = true
exportMenu.hidden = true

const STORAGE_TYPES = ["cookies", "localStorage", "sessionStorage"]
const LIVE_SYNC_INTERVAL_MS = 1500
const EXPORT_PREFS_KEY = "exportSelectedTypes"

const COOKIE_SCHEMA = {
    keyField: "__id",
    columns: [
        { id: "expand", label: "", width: 24 },
        { id: "name", label: "Name", minWidth: 150 },
        { id: "value", label: "Value" },
        { id: "actions", label: "Actions", width: 80 }
    ]
}

const WEB_STORAGE_SCHEMA = {
    keyField: "key",
    columns: [
        { id: "expand", label: "", width: 24 },
        { id: "key", label: "Key", minWidth: 150 },
        { id: "value", label: "Value" },
        { id: "actions", label: "Actions", width: 80 }
    ]
}

function buildWebStorageConfig(area, label) {
    return {
        label,
        mode: "webStorage",
        schema: WEB_STORAGE_SCHEMA,
        filterPlaceholder: `Search ${label.toLowerCase()}...`,

        list: async tab => {
            return await sendBackgroundMessage({
                type: "WEB_STORAGE_LIST",
                tabId: tab.id,
                area
            })
        },

        create: async (tab, payload) => {
            return await sendBackgroundMessage({
                type: "WEB_STORAGE_SET",
                tabId: tab.id,
                details: {
                    area,
                    key: payload.key,
                    value: payload.value
                }
            })
        },

        edit: async (tab, payload) => {
            return await sendBackgroundMessage({
                type: "WEB_STORAGE_SET",
                tabId: tab.id,
                details: {
                    area,
                    key: payload.updated.key,
                    value: payload.updated.value,
                    previousKey: payload.original.key
                }
            })
        },

        remove: async (tab, row) => {
            return await sendBackgroundMessage({
                type: "WEB_STORAGE_DELETE",
                tabId: tab.id,
                details: {
                    area,
                    key: row.key
                }
            })
        },

        bulkRemove: async (tab, rows) => {
            return await sendBackgroundMessage({
                type: "WEB_STORAGE_BULK_DELETE",
                tabId: tab.id,
                details: {
                    area,
                    keys: rows.map(row => row.key)
                }
            })
        }
    }
}

const STORAGE_CONFIG = {
    cookies: {
        label: "cookies",
        mode: "cookies",
        schema: COOKIE_SCHEMA,
        filterPlaceholder: "Search cookies...",

        list: async tab => {
            const cookies = await sendBackgroundMessage({
                type: "COOKIES_LIST",
                url: tab.url
            })

            return cookies.map(cookie => ({
                ...cookie,
                __id: makeCookieId(cookie)
            }))
        },

        create: async (tab, payload) => {
            return await sendBackgroundMessage({
                type: "COOKIE_SET",
                details: buildCookieSetDetails(tab, payload)
            })
        },

        edit: async (tab, payload) => {
            const result = await sendBackgroundMessage({
                type: "COOKIE_SET",
                details: buildCookieSetDetails(tab, payload.updated)
            })

            await cleanupReplacedCookie(tab, payload.original, payload.updated)
            return result
        },

        remove: async (tab, row) => {
            return await sendBackgroundMessage({
                type: "COOKIE_DELETE",
                details: buildCookieDeleteDetails(tab, row)
            })
        },

        bulkRemove: async (tab, rows) => {
            const outcomes = await Promise.all(rows.map(async row => {
                try {
                    await sendBackgroundMessage({
                        type: "COOKIE_DELETE",
                        details: buildCookieDeleteDetails(tab, row)
                    })
                    return { ok: true }
                } catch (error) {
                    return { ok: false, label: row.name, error: error?.message || String(error) }
                }
            }))

            return summarizeOutcomes(outcomes)
        }
    },
    localStorage: buildWebStorageConfig("localStorage", "LocalStorage"),
    sessionStorage: buildWebStorageConfig("sessionStorage", "SessionStorage")
}

let activeStore = "cookies"
let currentHost = ""
let lastLoadedSignature = ""
let lastLoadedTabId = null
let liveSyncTimer = null
let liveSyncInFlight = false

const grid = new StorageGrid(
    table,
    STORAGE_CONFIG.cookies.schema,
    buildGridHandlers("cookies"),
    { mode: STORAGE_CONFIG.cookies.mode }
)

function makeCookieId(cookie) {
    const identity = buildCookieIdentity(cookie)
    return [identity.name, identity.domain, identity.path, identity.storeId, identity.partition].join("|")
}

function normalizeCookieDomainForIdentity(domain) {
    return String(domain || "").replace(/^\./, "").toLowerCase()
}

function normalizeCookiePathForIdentity(path) {
    const value = String(path || "/")
    return value.startsWith("/") ? value : "/"
}

function getPartitionKeySignature(partitionKey) {
    if (!partitionKey || typeof partitionKey !== "object") return ""

    const topLevelSite = partitionKey.topLevelSite ? String(partitionKey.topLevelSite) : ""
    const hasCrossSiteAncestor = partitionKey.hasCrossSiteAncestor === true ? "1" : "0"
    return `${topLevelSite}|${hasCrossSiteAncestor}`
}

function buildCookieIdentity(cookie) {
    return {
        name: String(cookie?.name || ""),
        domain: normalizeCookieDomainForIdentity(cookie?.domain),
        path: normalizeCookiePathForIdentity(cookie?.path),
        storeId: String(cookie?.storeId || ""),
        partition: getPartitionKeySignature(cookie?.partitionKey)
    }
}

function isSameCookieIdentity(left, right) {
    return left.name === right.name &&
        left.domain === right.domain &&
        left.path === right.path &&
        left.storeId === right.storeId &&
        left.partition === right.partition
}

async function cleanupReplacedCookie(tab, original, updated) {
    if (!original || !updated) return

    const originalIdentity = buildCookieIdentity(original)
    const updatedIdentity = buildCookieIdentity(updated)

    if (isSameCookieIdentity(originalIdentity, updatedIdentity)) {
        return
    }

    await sendBackgroundMessage({
        type: "COOKIE_DELETE",
        details: buildCookieDeleteDetails(tab, original)
    })

    const cookies = await sendBackgroundMessage({
        type: "COOKIES_LIST",
        url: tab.url
    })

    for (const cookie of cookies) {
        const candidateIdentity = buildCookieIdentity(cookie)

        if (isSameCookieIdentity(candidateIdentity, originalIdentity) &&
            !isSameCookieIdentity(candidateIdentity, updatedIdentity)) {
            await sendBackgroundMessage({
                type: "COOKIE_DELETE",
                details: buildCookieDeleteDetails(tab, cookie)
            })
        }
    }
}

function buildCookieUrl(cookie, fallbackUrl) {
    try {
        const fallback = new URL(fallbackUrl)
        const scheme = cookie.secure ? "https:" : "http:"
        const host = String(cookie.domain || fallback.hostname).replace(/^\./, "") || fallback.hostname
        const path = cookie.path && cookie.path.startsWith("/") ? cookie.path : "/"

        return `${scheme}//${host}${path}`
    } catch {
        return fallbackUrl
    }
}

function normalizeSameSite(value) {
    if (!value) return undefined

    const normalized = String(value).toLowerCase()

    if (normalized === "none" || normalized === "no_restriction") return "no_restriction"
    if (normalized === "lax") return "lax"
    if (normalized === "strict") return "strict"

    return undefined
}

function resolveExpirationDate(payload) {
    if (payload.maxAge === "" || payload.maxAge === undefined || payload.maxAge === null) {
        return payload.expirationDate
    }

    const maxAgeSeconds = Number(payload.maxAge)
    if (Number.isNaN(maxAgeSeconds)) {
        return payload.expirationDate
    }

    return Math.floor(Date.now() / 1000) + maxAgeSeconds
}

function buildCookieSetDetails(tab, payload) {
    return {
        url: tab.url,
        name: payload.name,
        value: String(payload.value ?? ""),
        domain: payload.domain,
        path: payload.path || "/",
        secure: Boolean(payload.secure),
        httpOnly: Boolean(payload.httpOnly),
        sameSite: normalizeSameSite(payload.sameSite),
        expirationDate: resolveExpirationDate(payload),
        storeId: payload.storeId,
        partitionKey: payload.partitionKey
    }
}

function buildCookieDeleteDetails(tab, row) {
    return {
        url: buildCookieUrl(row, tab.url),
        name: row.name,
        storeId: row.storeId,
        partitionKey: row.partitionKey
    }
}

function getRowPrimaryField(row) {
    if (row.name !== undefined) return row.name
    if (row.key !== undefined) return row.key
    return ""
}

function getHostFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "")
    } catch {
        return ""
    }
}

function getCurrentStoreConfig() {
    return STORAGE_CONFIG[activeStore]
}

function setActiveTabUI(storeType) {
    tabButtons.forEach(button => {
        button.classList.toggle("active", button.dataset.store === storeType)
    })
}

function applyToolbarForStore(storeType) {
    const config = STORAGE_CONFIG[storeType]
    filterInput.placeholder = config.filterPlaceholder
}

function setDeleteAllEnabled(enabled) {
    deleteAllBtn.disabled = !enabled
}

function getStoreDisplayName(storeType) {
    if (storeType === "cookies") return "cookies"
    if (storeType === "localStorage") return "local storage items"
    if (storeType === "sessionStorage") return "session storage items"
    return "items"
}

function hashString(input) {
    let hash = 2166136261

    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i)
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }

    return (hash >>> 0).toString(16)
}

function buildRowToken(storeType, row) {
    if (storeType === "cookies") {
        return [
            makeCookieId(row),
            String(row.value ?? ""),
            String(row.expirationDate ?? ""),
            String(row.sameSite ?? ""),
            row.secure ? "1" : "0",
            row.httpOnly ? "1" : "0"
        ].join("\u001e")
    }

    return [
        String(row.key ?? ""),
        String(row.value ?? "")
    ].join("\u001e")
}

function buildStoreSignature(storeType, tab, rows) {
    const host = getHostFromUrl(tab.url)
    const tokens = rows.map(row => buildRowToken(storeType, row)).sort()
    const raw = [
        String(tab.id),
        host,
        storeType,
        String(tokens.length),
        tokens.join("\u001f")
    ].join("\u001d")

    return hashString(raw)
}

function applyRowsToGrid(tab, rows, signature) {
    currentHost = getHostFromUrl(tab.url)
    grid.setData(rows, currentHost)
    setDeleteAllEnabled(rows.length > 0)

    if (filterInput.value) {
        grid.filter(filterInput.value)
    }

    lastLoadedTabId = tab.id
    lastLoadedSignature = signature
}

function shouldPauseLiveSync() {
    if (document.hidden) return true
    if (table.querySelector(".grid-expand")) return true

    // Only pause for focus inside the grid itself (e.g. an expand-row field).
    // Focus in the toolbar (search box, export checkboxes) shouldn't block sync.
    const activeElement = document.activeElement
    if (!activeElement || !table.contains(activeElement)) return false

    const activeTag = activeElement.tagName
    return activeTag === "INPUT" || activeTag === "TEXTAREA" || activeTag === "SELECT"
}

function showDeleteAllConfirm(message) {
    return new Promise(resolve => {
        confirmMessage.textContent = message
        confirmOverlay.hidden = false
        document.body.style.overflow = "hidden"

        const close = confirmed => {
            confirmOverlay.hidden = true
            document.body.style.overflow = ""
            confirmCancelBtn.removeEventListener("click", onCancel)
            confirmDeleteBtn.removeEventListener("click", onConfirm)
            confirmOverlay.removeEventListener("click", onOverlayClick)
            document.removeEventListener("keydown", onKeyDown)
            resolve(confirmed)
        }

        const onCancel = () => close(false)
        const onConfirm = () => close(true)
        const onOverlayClick = e => {
            if (e.target === confirmOverlay) close(false)
        }
        const onKeyDown = e => {
            if (e.key === "Escape") close(false)
        }

        confirmCancelBtn.addEventListener("click", onCancel)
        confirmDeleteBtn.addEventListener("click", onConfirm)
        confirmOverlay.addEventListener("click", onOverlayClick)
        document.addEventListener("keydown", onKeyDown)
    })
}

function showCustomAlert(message, title = "Notice") {
    return new Promise(resolve => {
        const titleEl = alertOverlay.querySelector("h3")
        if (titleEl) titleEl.textContent = title

        alertMessage.textContent = String(message || "Something went wrong")
        alertOverlay.hidden = false
        document.body.style.overflow = "hidden"

        const close = () => {
            alertOverlay.hidden = true
            document.body.style.overflow = ""
            alertOkBtn.removeEventListener("click", onOk)
            alertOverlay.removeEventListener("click", onOverlayClick)
            document.removeEventListener("keydown", onKeyDown)
            resolve()
        }

        const onOk = () => close()
        const onOverlayClick = e => {
            if (e.target === alertOverlay) close()
        }
        const onKeyDown = e => {
            if (e.key === "Escape" || e.key === "Enter") close()
        }

        alertOkBtn.addEventListener("click", onOk)
        alertOverlay.addEventListener("click", onOverlayClick)
        document.addEventListener("keydown", onKeyDown)
    })
}

function normalizeStorageItems(items) {
    const seen = new Map()

    for (const row of Array.isArray(items) ? items : []) {
        if (!row || typeof row !== "object") continue

        const key = String(row.key ?? "").trim()
        if (!key) continue

        seen.set(key, {
            key,
            value: String(row.value ?? "")
        })
    }

    return Array.from(seen.values())
}

function normalizeCookieItems(items) {
    const list = []

    for (const raw of Array.isArray(items) ? items : []) {
        if (!raw || typeof raw !== "object") continue

        const name = String(raw.name ?? "").trim()
        if (!name) continue

        const cookie = {
            name,
            value: String(raw.value ?? ""),
            domain: raw.domain ? String(raw.domain) : undefined,
            path: raw.path ? String(raw.path) : "/",
            secure: Boolean(raw.secure),
            httpOnly: Boolean(raw.httpOnly),
            sameSite: normalizeSameSite(raw.sameSite),
            expirationDate: Number.isFinite(Number(raw.expirationDate)) ? Number(raw.expirationDate) : undefined,
            storeId: raw.storeId ? String(raw.storeId) : undefined,
            partitionKey: raw.partitionKey && typeof raw.partitionKey === "object" ? raw.partitionKey : undefined
        }

        list.push(cookie)
    }

    return list
}

function makeSnapshotFileName(tab) {
    const host = getHostFromUrl(tab.url) || "site"
    const date = new Date().toISOString().replace(/[:.]/g, "-")
    return `storage-control-${host}-${date}.json`
}

function setExportMenuOpen(isOpen) {
    exportMenu.hidden = !isOpen
    exportToggleBtn.setAttribute("aria-expanded", String(isOpen))
    exportMenuWrap.classList.toggle("open", isOpen)
}

function normalizeExportPreferences(rawValue) {
    const source = rawValue && typeof rawValue === "object" ? rawValue : {}

    return {
        cookies: source.cookies !== undefined ? Boolean(source.cookies) : true,
        localStorage: source.localStorage !== undefined ? Boolean(source.localStorage) : true,
        sessionStorage: source.sessionStorage !== undefined ? Boolean(source.sessionStorage) : true
    }
}

function applyExportPreferences(prefs) {
    exportCookiesCheckbox.checked = prefs.cookies
    exportLocalStorageCheckbox.checked = prefs.localStorage
    exportSessionStorageCheckbox.checked = prefs.sessionStorage
}

async function loadExportPreferences() {
    if (!chrome.storage?.local) return

    try {
        const result = await chrome.storage.local.get(EXPORT_PREFS_KEY)
        const prefs = normalizeExportPreferences(result?.[EXPORT_PREFS_KEY])
        applyExportPreferences(prefs)
    } catch (error) {
        console.warn("Failed to load export preferences", error)
    }
}

async function saveExportPreferences() {
    if (!chrome.storage?.local) return

    try {
        await chrome.storage.local.set({
            [EXPORT_PREFS_KEY]: getSelectedExportTypes()
        })
    } catch (error) {
        console.warn("Failed to save export preferences", error)
    }
}

function getSelectedExportTypes() {
    return {
        cookies: exportCookiesCheckbox.checked,
        localStorage: exportLocalStorageCheckbox.checked,
        sessionStorage: exportSessionStorageCheckbox.checked
    }
}

function downloadJson(payload, fileName) {
    const json = JSON.stringify(payload, null, 2)
    const blob = new Blob([json], { type: "application/json" })
    const url = URL.createObjectURL(blob)

    const link = document.createElement("a")
    link.href = url
    link.download = fileName
    link.click()

    URL.revokeObjectURL(url)
}

function getStorageTypeLabel(type) {
    if (type === "cookies") return "cookies"
    if (type === "localStorage") return "local storage"
    if (type === "sessionStorage") return "session storage"
    return type
}

function isStorageType(value) {
    return STORAGE_TYPES.includes(value)
}

function parseSelectedTypes(rawSelectedTypes) {
    if (rawSelectedTypes === undefined) return null
    if (!Array.isArray(rawSelectedTypes)) {
        throw new Error("Import file has invalid selectedTypes metadata")
    }

    const selected = []

    for (const rawType of rawSelectedTypes) {
        const type = String(rawType)

        if (!isStorageType(type)) {
            throw new Error(`Import file has unsupported storage type "${type}"`)
        }

        if (!selected.includes(type)) {
            selected.push(type)
        }
    }

    if (selected.length === 0) {
        throw new Error("Import file selected no storage types")
    }

    return selected
}

function assertImportArray(source, type) {
    if (!(type in source)) {
        throw new Error(`Import file is missing ${getStorageTypeLabel(type)} data`)
    }

    const value = source[type]
    if (!Array.isArray(value)) {
        throw new Error(`Import file has invalid ${getStorageTypeLabel(type)} format`)
    }

    return value
}

function validateStorageImportItems(items, type) {
    items.forEach((item, index) => {
        if (!item || typeof item !== "object") {
            throw new Error(`Invalid ${getStorageTypeLabel(type)} entry at index ${index}`)
        }

        const key = String(item.key ?? "").trim()
        if (!key) {
            throw new Error(`Missing key in ${getStorageTypeLabel(type)} entry at index ${index}`)
        }
    })
}

function validateCookieImportItems(items) {
    items.forEach((item, index) => {
        if (!item || typeof item !== "object") {
            throw new Error(`Invalid cookie entry at index ${index}`)
        }

        const name = String(item.name ?? "").trim()
        if (!name) {
            throw new Error(`Missing name in cookie entry at index ${index}`)
        }
    })
}

function readImportPayload(text) {
    let parsed

    try {
        parsed = JSON.parse(text)
    } catch {
        throw new Error("Invalid JSON file")
    }

    const source = parsed && typeof parsed === "object" && parsed.payload && typeof parsed.payload === "object"
        ? parsed.payload
        : parsed

    if (!source || typeof source !== "object") {
        throw new Error("Unsupported import format")
    }

    const selectedFromMetadata = parseSelectedTypes(source.selectedTypes ?? parsed.selectedTypes)
    const includedTypes = selectedFromMetadata || STORAGE_TYPES.filter(type => type in source)

    if (includedTypes.length === 0) {
        throw new Error("Import file does not contain cookies, localStorage, or sessionStorage data")
    }

    const rawByType = {}

    for (const type of includedTypes) {
        rawByType[type] = assertImportArray(source, type)
    }

    if (includedTypes.includes("cookies")) {
        validateCookieImportItems(rawByType.cookies)
    }
    if (includedTypes.includes("localStorage")) {
        validateStorageImportItems(rawByType.localStorage, "localStorage")
    }
    if (includedTypes.includes("sessionStorage")) {
        validateStorageImportItems(rawByType.sessionStorage, "sessionStorage")
    }

    return {
        includedTypes,
        cookies: includedTypes.includes("cookies") ? normalizeCookieItems(rawByType.cookies) : [],
        localStorage: includedTypes.includes("localStorage") ? normalizeStorageItems(rawByType.localStorage) : [],
        sessionStorage: includedTypes.includes("sessionStorage") ? normalizeStorageItems(rawByType.sessionStorage) : []
    }
}

async function exportAllStoresForTab(tab, selectedTypes) {
    const payload = {
        version: 1,
        exportedAt: new Date().toISOString(),
        source: {
            url: tab.url,
            host: getHostFromUrl(tab.url)
        },
        selectedTypes: Object.entries(selectedTypes)
            .filter(([, enabled]) => enabled)
            .map(([type]) => type)
    }

    const tasks = []

    if (selectedTypes.cookies) {
        tasks.push(
            sendBackgroundMessage({ type: "COOKIES_LIST", url: tab.url })
                .then(cookies => {
                    payload.cookies = normalizeCookieItems(cookies)
                })
        )
    }

    if (selectedTypes.localStorage) {
        tasks.push(
            sendBackgroundMessage({ type: "WEB_STORAGE_LIST", tabId: tab.id, area: "localStorage" })
                .then(items => {
                    payload.localStorage = normalizeStorageItems(items)
                })
        )
    }

    if (selectedTypes.sessionStorage) {
        tasks.push(
            sendBackgroundMessage({ type: "WEB_STORAGE_LIST", tabId: tab.id, area: "sessionStorage" })
                .then(items => {
                    payload.sessionStorage = normalizeStorageItems(items)
                })
        )
    }

    await Promise.all(tasks)
    return payload
}

function summarizeOutcomes(outcomes) {
    const applied = outcomes.filter(outcome => outcome.ok).length
    const failed = outcomes
        .filter(outcome => !outcome.ok)
        .map(({ label, error }) => ({ label, error }))

    return { applied, failed }
}

function describeFailures(failed, limit = 3) {
    const reasons = failed
        .slice(0, limit)
        .map(item => `${item.label || "(unnamed)"}: ${item.error}`)
        .join("; ")
    const more = failed.length > limit ? ` (+${failed.length - limit} more)` : ""

    return `${reasons}${more}`
}

async function applyCookies(tab, cookies) {
    const outcomes = await Promise.all(cookies.map(async cookie => {
        try {
            await sendBackgroundMessage({
                type: "COOKIE_SET",
                details: buildCookieSetDetails(tab, cookie)
            })
            return { ok: true }
        } catch (error) {
            return { ok: false, label: cookie.name, error: error?.message || String(error) }
        }
    }))

    return summarizeOutcomes(outcomes)
}

async function applyWebStorageItems(tab, area, items) {
    const outcomes = await Promise.all(items.map(async item => {
        try {
            await sendBackgroundMessage({
                type: "WEB_STORAGE_SET",
                tabId: tab.id,
                details: {
                    area,
                    key: item.key,
                    value: item.value
                }
            })
            return { ok: true }
        } catch (error) {
            return { ok: false, label: item.key, error: error?.message || String(error) }
        }
    }))

    return summarizeOutcomes(outcomes)
}

async function importAllStoresToTab(tab, payload) {
    const summary = {}

    for (const type of payload.includedTypes) {
        if (type === "cookies") {
            summary.cookies = await applyCookies(tab, payload.cookies)
            continue
        }

        if (type === "localStorage") {
            summary.localStorage = await applyWebStorageItems(tab, "localStorage", payload.localStorage)
            continue
        }

        if (type === "sessionStorage") {
            summary.sessionStorage = await applyWebStorageItems(tab, "sessionStorage", payload.sessionStorage)
        }
    }

    return summary
}

function buildImportSummaryMessage(summary) {
    const lines = []
    let totalFailed = 0

    for (const [type, result] of Object.entries(summary)) {
        if (!result) continue

        const label = getStorageTypeLabel(type)

        if (result.failed.length === 0) {
            lines.push(`${label}: imported ${result.applied}.`)
            continue
        }

        totalFailed += result.failed.length
        lines.push(`${label}: imported ${result.applied}, failed ${result.failed.length} (${describeFailures(result.failed)}).`)
    }

    return totalFailed > 0 ? lines.join("\n") : null
}

async function sendBackgroundMessage(message) {
    const response = await chrome.runtime.sendMessage(message)

    if (!response?.ok) {
        throw new Error(response?.error || "Background request failed")
    }

    return response.result
}

async function getActiveTab() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab?.id || !tab?.url) {
        throw new Error("No active tab available")
    }

    return tab
}

function buildGridHandlers(storeType) {
    return {
        onCreate: async payload => {
            const tab = await getActiveTab()
            await STORAGE_CONFIG[storeType].create(tab, payload)
            await loadActiveStore()
        },

        onEdit: async payload => {
            const tab = await getActiveTab()
            await STORAGE_CONFIG[storeType].edit(tab, payload)
            await loadActiveStore()
        },

        onDelete: async row => {
            const tab = await getActiveTab()
            await STORAGE_CONFIG[storeType].remove(tab, row)
            await loadActiveStore()
        },

        onAlert: async message => {
            await showCustomAlert(message, "Validation")
        },

        onContextMenu: (e, row) => {
            const primaryField = getRowPrimaryField(row)

            showContextMenu(e.clientX, e.clientY, [
                { label: "Copy Key", action: () => navigator.clipboard.writeText(primaryField) },
                { label: "Copy Value", action: () => navigator.clipboard.writeText(String(row.value || "")) },
                {
                    label: "Copy as JSON",
                    action: () => navigator.clipboard.writeText(JSON.stringify(row, null, 2))
                }
            ])
        }
    }
}

async function syncActiveStore(options = {}) {
    const { force = false, skipWhileEditing = false } = options

    if (liveSyncInFlight) return
    if (skipWhileEditing && shouldPauseLiveSync()) return

    liveSyncInFlight = true

    try {
        const tab = await getActiveTab()
        const rows = await getCurrentStoreConfig().list(tab)
        const signature = buildStoreSignature(activeStore, tab, rows)
        const tabChanged = tab.id !== lastLoadedTabId

        if (force || tabChanged || signature !== lastLoadedSignature) {
            applyRowsToGrid(tab, rows, signature)
        }
    } finally {
        liveSyncInFlight = false
    }
}

async function loadActiveStore(force = true) {
    await syncActiveStore({ force })
}

function startLiveSync() {
    stopLiveSync()

    liveSyncTimer = setInterval(() => {
        runSafely(async () => {
            await syncActiveStore({
                force: false,
                skipWhileEditing: true
            })
        }, false)
    }, LIVE_SYNC_INTERVAL_MS)
}

function stopLiveSync() {
    if (!liveSyncTimer) return

    clearInterval(liveSyncTimer)
    liveSyncTimer = null
}

async function switchStore(storeType) {
    if (!STORAGE_CONFIG[storeType]) return

    activeStore = storeType

    setActiveTabUI(storeType)
    applyToolbarForStore(storeType)

    grid.setMode(STORAGE_CONFIG[storeType].mode)
    grid.setSchema(STORAGE_CONFIG[storeType].schema)
    grid.setHandlers(buildGridHandlers(storeType))

    grid.setData([], currentHost)
    setDeleteAllEnabled(false)
    lastLoadedSignature = ""
    lastLoadedTabId = null

    await loadActiveStore()
}

async function runSafely(action, showAlert = true) {
    try {
        await action()
    } catch (error) {
        console.error(error)
        if (showAlert) {
            await showCustomAlert(error?.message || "Storage operation failed", "Error")
        }
    }
}

setExportMenuOpen(false)

tabButtons.forEach(button => {
    button.onclick = () => {
        runSafely(async () => {
            await switchStore(button.dataset.store)
        })
    }
})

refreshIconBtn.onclick = () => {
    runSafely(async () => {
        await loadActiveStore()
    })
}

exportBtn.onclick = () => {
    runSafely(async () => {
        const selectedTypes = getSelectedExportTypes()
        const hasSelection = Object.values(selectedTypes).some(Boolean)

        if (!hasSelection) {
            await showCustomAlert("Select at least one storage type to export.", "Export Options")
            return
        }

        const tab = await getActiveTab()
        const payload = await exportAllStoresForTab(tab, selectedTypes)
        downloadJson(payload, makeSnapshotFileName(tab))
        setExportMenuOpen(false)
    })
}

exportToggleBtn.onclick = event => {
    event.stopPropagation()
    setExportMenuOpen(exportMenu.hidden)
}

exportCookiesCheckbox.addEventListener("change", () => {
    saveExportPreferences()
})

exportLocalStorageCheckbox.addEventListener("change", () => {
    saveExportPreferences()
})

exportSessionStorageCheckbox.addEventListener("change", () => {
    saveExportPreferences()
})

createFab.onclick = () => {
    grid.createNewRow()
}

filterInput.addEventListener('input', e => {
    grid.filter(e.target.value)
})

deleteAllBtn.onclick = () => {
    runSafely(async () => {
        const rows = grid.allData.slice()
        if (rows.length === 0) return

        const label = getStoreDisplayName(activeStore)
        const confirmed = await showDeleteAllConfirm(
            `This will permanently delete all ${rows.length} ${label} for the current page.`
        )

        if (!confirmed) return

        const tab = await getActiveTab()
        const result = await getCurrentStoreConfig().bulkRemove(tab, rows)
        await loadActiveStore()

        if (result?.failed?.length) {
            await showCustomAlert(
                `Deleted ${result.applied} ${label}. Failed to delete ${result.failed.length} (${describeFailures(result.failed)}).`,
                "Delete Incomplete"
            )
        }
    })
}

importBtn.onclick = () => {
    importFileInput.value = ""
    importFileInput.click()
}

importFileInput.onchange = () => {
    runSafely(async () => {
        const file = importFileInput.files?.[0]
        if (!file) return

        const text = await file.text()
        const payload = readImportPayload(text)

        const tab = await getActiveTab()
        const summary = await importAllStoresToTab(tab, payload)
        await loadActiveStore()

        const message = buildImportSummaryMessage(summary)
        if (message) {
            await showCustomAlert(message, "Import Completed With Errors")
        }
    })
}

chrome.tabs.onActivated.addListener(() => {
    runSafely(async () => {
        await loadActiveStore()
    }, false)
})

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
    if (!tab.active) return

    if (info.status === "loading") {
        lastLoadedSignature = ""
        lastLoadedTabId = tabId
        return
    }

    if (info.status === "complete") {
        runSafely(async () => {
            await loadActiveStore(true)
        }, false)
    }
})

document.addEventListener("click", event => {
    if (!exportMenuWrap.contains(event.target)) {
        setExportMenuOpen(false)
    }
})

document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !exportMenu.hidden) {
        setExportMenuOpen(false)
    }
})

if (chrome.cookies?.onChanged) {
    chrome.cookies.onChanged.addListener(() => {
        if (activeStore !== "cookies") return

        runSafely(async () => {
            await syncActiveStore({
                force: false,
                skipWhileEditing: true
            })
        }, false)
    })
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) return

    runSafely(async () => {
        await syncActiveStore({ force: true })
    }, false)
})

window.addEventListener("beforeunload", () => {
    stopLiveSync()
})

startLiveSync()

runSafely(async () => {
    await loadExportPreferences()
    await switchStore(activeStore)
})
