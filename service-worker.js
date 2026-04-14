import { getCookies, setCookie, deleteCookie } from './storage/cookies.js'
import {
    listWebStorage,
    setWebStorageItem,
    deleteWebStorageItem,
    deleteManyWebStorageItems
} from './storage/webStorage.js'


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    handleMessage(msg)
        .then(result => {
            sendResponse({ ok: true, result })
        })
        .catch(error => {
            sendResponse({
                ok: false,
                error: error?.message || "Unknown service worker error"
            })
        })

    return true
})

async function handleMessage(msg) {
    if (msg.type === 'COOKIES_LIST') {
        return await getCookies(msg.url)
    }

    if (msg.type === 'COOKIE_DELETE') {
        return await deleteCookie(msg.details)
    }

    if (msg.type === 'COOKIE_SET') {
        return await setCookie(msg.details)
    }

    if (msg.type === 'WEB_STORAGE_LIST') {
        return await listWebStorage(msg.tabId, msg.area)
    }

    if (msg.type === 'WEB_STORAGE_SET') {
        return await setWebStorageItem(msg.tabId, msg.details)
    }

    if (msg.type === 'WEB_STORAGE_DELETE') {
        return await deleteWebStorageItem(msg.tabId, msg.details)
    }

    if (msg.type === 'WEB_STORAGE_BULK_DELETE') {
        return await deleteManyWebStorageItems(msg.tabId, msg.details)
    }

    throw new Error(`Unsupported message type: ${msg.type}`)
}


chrome.action.onClicked.addListener(tab => {
    if (!tab?.id) return

    chrome.sidePanel.open({ tabId: tab.id })
        .catch(error => {
            console.error("Failed to open side panel:", error)
        })
})

chrome.runtime.onInstalled.addListener(details => {
    if (details.reason !== "install") return

    chrome.tabs.create({
        url: chrome.runtime.getURL("guide.html")
    })
})


async function ensureSidePanelForTab(tabId) {
    await chrome.sidePanel.setOptions({
        tabId,
        enabled: true,
        path: "sidepanel.html"
    })
}

chrome.tabs.onActivated.addListener(async e => {
    if (!e?.tabId) return

    try {
        await ensureSidePanelForTab(e.tabId)
    } catch (error) {
        console.error("Failed to set side panel options on activation:", error)
    }
})


chrome.tabs.onUpdated.addListener(async (tabId, info, tab) => {
    if (info.status === "complete" && tab.active) {
        try {
            await ensureSidePanelForTab(tabId)
        } catch (error) {
            console.error("Failed to set side panel options on update:", error)
        }
    }
})

chrome.tabs.onRemoved.addListener(() => {
    chrome.tabs.query({ active: true, currentWindow: true })
        .then(tabs => {
            if (!tabs[0]?.id) return
            return ensureSidePanelForTab(tabs[0].id)
        })
        .catch(error => {
            console.error("Failed to set side panel options on tab removal:", error)
        })
})
