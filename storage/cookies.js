export async function getCookies(url) {
  return await chrome.cookies.getAll({ url })
}

export async function deleteCookie(raw) {
  const details = {
    url: raw.url,
    name: raw.name,
    storeId: raw.storeId,
    partitionKey: raw.partitionKey
  }

  Object.keys(details).forEach(
    key => details[key] === undefined && delete details[key]
  )

  return await chrome.cookies.remove(details)
}

export async function setCookie(raw) {
  const allowed = {
    url: raw.url,
    name: raw.name,
    value: raw.value,
    domain: raw.domain,
    path: raw.path,
    secure: raw.secure,
    httpOnly: raw.httpOnly,
    sameSite: raw.sameSite,
    expirationDate: raw.expirationDate,
    storeId: raw.storeId,
    partitionKey: raw.partitionKey
  }

  // Remove undefined fields
  Object.keys(allowed).forEach(
    key => allowed[key] === undefined && delete allowed[key]
  )

  if (raw.name?.startsWith("__Host-")) {
    delete allowed.domain
    allowed.path = "/"
    allowed.secure = true
  }

  if (raw.name?.startsWith("__Secure-")) {
    allowed.secure = true
  }


  return await chrome.cookies.set(allowed)
}
