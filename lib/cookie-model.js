/**
 * @fileoverview Pure data helpers for cookies, web storage and import/export.
 *
 * Split out of sidepanel.js so they can be unit tested: sidepanel.js reads
 * document.getElementById at module top level, which makes it unimportable
 * outside a browser. Nothing here touches the DOM or the chrome APIs - every
 * function takes its inputs as arguments and returns a value.
 */

export const STORAGE_TYPES = ["cookies", "localStorage", "sessionStorage"]

export function makeCookieId(cookie) {
    const identity = buildCookieIdentity(cookie)
    return [identity.name, identity.domain, identity.path, identity.storeId, identity.partition].join("|")
}

export function normalizeCookieDomainForIdentity(domain) {
    return String(domain || "").replace(/^\./, "").toLowerCase()
}

export function normalizeCookiePathForIdentity(path) {
    const value = String(path || "/")
    return value.startsWith("/") ? value : "/"
}

export function getPartitionKeySignature(partitionKey) {
    if (!partitionKey || typeof partitionKey !== "object") return ""

    const topLevelSite = partitionKey.topLevelSite ? String(partitionKey.topLevelSite) : ""
    const hasCrossSiteAncestor = partitionKey.hasCrossSiteAncestor === true ? "1" : "0"
    return `${topLevelSite}|${hasCrossSiteAncestor}`
}

export function buildCookieIdentity(cookie) {
    return {
        name: String(cookie?.name || ""),
        domain: normalizeCookieDomainForIdentity(cookie?.domain),
        path: normalizeCookiePathForIdentity(cookie?.path),
        storeId: String(cookie?.storeId || ""),
        partition: getPartitionKeySignature(cookie?.partitionKey)
    }
}

export function isSameCookieIdentity(left, right) {
    return left.name === right.name &&
        left.domain === right.domain &&
        left.path === right.path &&
        left.storeId === right.storeId &&
        left.partition === right.partition
}

export function buildCookieUrl(cookie, fallbackUrl) {
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

export function normalizeSameSite(value) {
    if (!value) return undefined

    const normalized = String(value).toLowerCase()

    if (normalized === "none" || normalized === "no_restriction") return "no_restriction"
    if (normalized === "lax") return "lax"
    if (normalized === "strict") return "strict"

    return undefined
}

export function resolveExpirationDate(payload) {
    if (payload.maxAge === "" || payload.maxAge === undefined || payload.maxAge === null) {
        return payload.expirationDate
    }

    const maxAgeSeconds = Number(payload.maxAge)
    if (Number.isNaN(maxAgeSeconds)) {
        return payload.expirationDate
    }

    return Math.floor(Date.now() / 1000) + maxAgeSeconds
}

export function buildCookieSetDetails(tab, payload) {
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

export function buildCookieDeleteDetails(tab, row) {
    return {
        url: buildCookieUrl(row, tab.url),
        name: row.name,
        storeId: row.storeId,
        partitionKey: row.partitionKey
    }
}

export function getRowPrimaryField(row) {
    if (row.name !== undefined) return row.name
    if (row.key !== undefined) return row.key
    return ""
}

export function getHostFromUrl(url) {
    try {
        return new URL(url).hostname.replace(/^www\./, "")
    } catch {
        return ""
    }
}

export function hashString(input) {
    let hash = 2166136261

    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i)
        hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24)
    }

    return (hash >>> 0).toString(16)
}

export function buildRowToken(storeType, row) {
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

export function buildStoreSignature(storeType, tab, rows) {
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

export function normalizeStorageItems(items) {
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

export function normalizeCookieItems(items) {
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

export function makeSnapshotFileName(tab) {
    const host = getHostFromUrl(tab.url) || "site"
    const date = new Date().toISOString().replace(/[:.]/g, "-")
    return `storage-control-${host}-${date}.json`
}

export function normalizeExportPreferences(rawValue) {
    const source = rawValue && typeof rawValue === "object" ? rawValue : {}

    return {
        cookies: source.cookies !== undefined ? Boolean(source.cookies) : true,
        localStorage: source.localStorage !== undefined ? Boolean(source.localStorage) : true,
        sessionStorage: source.sessionStorage !== undefined ? Boolean(source.sessionStorage) : true
    }
}

export function getStorageTypeLabel(type) {
    if (type === "cookies") return "cookies"
    if (type === "localStorage") return "local storage"
    if (type === "sessionStorage") return "session storage"
    return type
}

export function isStorageType(value) {
    return STORAGE_TYPES.includes(value)
}

export function parseSelectedTypes(rawSelectedTypes) {
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

export function summarizeOutcomes(outcomes) {
    const applied = outcomes.filter(outcome => outcome.ok).length
    const failed = outcomes
        .filter(outcome => !outcome.ok)
        .map(({ label, error }) => ({ label, error }))

    return { applied, failed }
}

export function describeFailures(failed, limit = 3) {
    const reasons = failed
        .slice(0, limit)
        .map(item => `${item.label || "(unnamed)"}: ${item.error}`)
        .join("; ")
    const more = failed.length > limit ? ` (+${failed.length - limit} more)` : ""

    return `${reasons}${more}`
}

export function assertImportArray(source, type) {
    if (!(type in source)) {
        throw new Error(`Import file is missing ${getStorageTypeLabel(type)} data`)
    }

    const value = source[type]
    if (!Array.isArray(value)) {
        throw new Error(`Import file has invalid ${getStorageTypeLabel(type)} format`)
    }

    return value
}

export function validateStorageImportItems(items, type) {
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

export function validateCookieImportItems(items) {
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

export function readImportPayload(text) {
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
