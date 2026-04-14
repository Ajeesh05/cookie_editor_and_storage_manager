async function executeInTab(tabId, fn, args = []) {
  const [result] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fn,
    args
  })

  return result?.result
}

export async function listWebStorage(tabId, area) {
  return await executeInTab(
    tabId,
    storageArea => {
      const storage = storageArea === "sessionStorage" ? window.sessionStorage : window.localStorage
      const rows = []

      for (let i = 0; i < storage.length; i += 1) {
        const key = storage.key(i)
        rows.push({
          key,
          value: storage.getItem(key) ?? ""
        })
      }

      rows.sort((a, b) => a.key.localeCompare(b.key))
      return rows
    },
    [area]
  )
}

export async function setWebStorageItem(tabId, { area, key, value, previousKey }) {
  const serializedArea = String(area)
  const serializedKey = key === undefined ? "" : String(key)
  const serializedValue = value === undefined ? "" : String(value)
  const serializedPreviousKey =
    previousKey === undefined ? null : String(previousKey)

  return await executeInTab(
    tabId,
    (storageArea, nextKey, nextValue, oldKey) => {
      const storage = storageArea === "sessionStorage" ? window.sessionStorage : window.localStorage
      const normalizedKey = String(nextKey ?? "").trim()

      if (!normalizedKey) {
        throw new Error("Key is required")
      }

      if (oldKey && oldKey !== normalizedKey) {
        storage.removeItem(oldKey)
      }

      storage.setItem(normalizedKey, String(nextValue ?? ""))

      return { ok: true, key: normalizedKey }
    },
    [serializedArea, serializedKey, serializedValue, serializedPreviousKey]
  )
}

export async function deleteWebStorageItem(tabId, { area, key }) {
  const serializedArea = String(area)
  const serializedKey = key === undefined ? "" : String(key)

  return await executeInTab(
    tabId,
    (storageArea, itemKey) => {
      const storage = storageArea === "sessionStorage" ? window.sessionStorage : window.localStorage
      storage.removeItem(itemKey)
      return { ok: true }
    },
    [serializedArea, serializedKey]
  )
}

export async function deleteManyWebStorageItems(tabId, { area, keys }) {
  const serializedArea = String(area)
  const serializedKeys = (keys || []).map(key => String(key))

  return await executeInTab(
    tabId,
    (storageArea, itemKeys) => {
      const storage = storageArea === "sessionStorage" ? window.sessionStorage : window.localStorage

      for (const key of itemKeys || []) {
        storage.removeItem(key)
      }

      return { ok: true, deleted: (itemKeys || []).length }
    },
    [serializedArea, serializedKeys]
  )
}
