export class StorageGrid {
    constructor(container, schema, handlers, options = {}) {
        this.container = container
        this.schema = schema
        this.handlers = handlers
        this.mode = options.mode || "cookies"
        this.tooltip = this.createTooltip()
        this.data = []
        this.allData = []
        this.currentHost = ""
    }

    setSchema(schema) {
        this.schema = schema
    }

    setHandlers(handlers) {
        this.handlers = handlers
    }

    setMode(mode) {
        this.mode = mode
    }

    buildDomainChain(host) {
        const normalized = String(host || "").replace(/^\./, "")
        if (!normalized) return []

        const parts = normalized.split(".").filter(Boolean)
        if (parts.length < 2) return [normalized]

        const chain = []

        for (let i = 0; i < parts.length - 1; i += 1) {
            const domain = parts.slice(i).join(".")
            if (i === 0) {
                chain.push(domain)
            } else {
                chain.push("." + domain)
            }
        }

        return chain
    }

    createTooltip() {
        const el = document.createElement("div")
        el.className = "tooltip"
        document.body.appendChild(el)
        return el
    }

    async showCustomAlert(message) {
        if (this.handlers?.onAlert) {
            await this.handlers.onAlert(message)
        }
    }

    setData(data, host) {
        this.currentHost = host || this.currentHost
        this.allData = data.slice()
        this.data = data.slice()
        this.draw()
    }

    createNewRow() {
        const blank = this.mode === "cookies"
            ? {
                __new: true,
                name: "",
                value: "",
                path: "/",
                secure: location.protocol === "https:",
                httpOnly: false,
                sameSite: "lax",
                domain: this.currentHost
            }
            : {
                __new: true,
                key: "",
                value: ""
            }

        this.data.unshift(blank)
        this.draw()

        const row = this.container.querySelector(".grid-row")
        const expandCell = row?.querySelector(".grid-cell")

        if (row && expandCell) {
            this.toggleExpand(row, blank, expandCell)
        }
    }

    draw() {
        this.container.innerHTML = ""
        this.renderHeader()
        this.data.forEach(row => this.renderRow(row))
    }

    renderHeader() {
        const header = document.createElement("div")
        header.className = "grid-header"

        this.schema.columns.forEach(col => {
            const cell = this.createCell(col.label, col, true)
            header.appendChild(cell)
        })

        this.container.appendChild(header)
    }

    renderRow(rowData) {
        const row = document.createElement("div")
        row.className = "grid-row"

        row.oncontextmenu = e => {
            e.preventDefault()
            if (this.handlers?.onContextMenu) {
                this.handlers.onContextMenu(e, rowData)
            }
        }

        let expandControl = null

        this.schema.columns.forEach(col => {
            let value = ""

            if (col.id === "expand") {
                value = ">"
            } else if (col.id === "actions") {
                value = "Delete"
            } else {
                value = rowData[col.id]
            }

            const cell = this.createCell(value, col, false, rowData)

            if (col.id === "expand") {
                expandControl = cell
                cell.onclick = e => {
                    e.stopPropagation()
                    this.toggleExpand(row, rowData, cell)
                }
            }

            if (col.id === "actions") {
                cell.classList.add("delete")

                cell.onclick = async e => {
                    e.stopPropagation()
                    await this.handlers.onDelete(rowData)
                }
            }

            row.appendChild(cell)
        })

        row.onclick = () => {
            if (expandControl) {
                this.toggleExpand(row, rowData, expandControl)
            }
        }

        this.container.appendChild(row)
    }

    createCell(value, col, isHeader, rowData) {
        const cell = document.createElement("div")
        cell.className = "grid-cell"

        if (col.width) {
            cell.style.flex = `0 0 ${col.width}px`
        }

        cell.textContent = value == null ? "" : String(value)

        if (!isHeader && col.editable) {
            this.enableTooltip(cell, rowData)
        }

        if (isHeader) {
            this.enableResize(cell, col)
        }

        return cell
    }

    toggleExpand(row, rowData, toggleCell) {
        if (row.nextSibling?.classList.contains("grid-expand")) {
            row.nextSibling.remove()
            toggleCell.textContent = ">"
            return
        }

        toggleCell.textContent = "▼"

        const expand = this.mode === "cookies"
            ? this.createCookieExpand(row, rowData, toggleCell)
            : this.createWebStorageExpand(row, rowData, toggleCell)

        row.after(expand)
    }

    escapeAttr(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
    }

    createCookieExpand(row, rowData, toggleCell) {
        const isNew = rowData.__new === true
        const expand = document.createElement("div")
        expand.className = "grid-expand"
        expand.style.display = "flex"
        expand.style.flexDirection = "column"
        expand.style.padding = "10px"
        expand.style.background = "#020617"
        expand.style.borderBottom = "1px solid #1f2933"

        const escapedName = this.escapeAttr(rowData.name)
        const escapedValue = this.escapeAttr(rowData.value || "")
        const escapedPath = this.escapeAttr(rowData.path || "/")
        const sizeBytes = new Blob([rowData.value || ""]).size

        expand.innerHTML = `
        <div class="expand-row security-banner" style="display:none"></div>
  <div class="expand-row">
    <label>Name</label>
    <input value="${escapedName}" data-field="name" />
  </div>

  <div class="expand-row">
    <label>Value</label>
    <input value="${escapedValue}" data-field="value" />
  </div>

  <div class="expand-row">
    <label>Scope</label>
    <select data-field="domainScope"></select>
  </div>

  <div class="expand-row">
    <label>Path</label>
    <input value="${escapedPath}" data-field="path" />
  </div>

  <div class="expand-row">
    <label>Secure</label>
    <input type="checkbox" data-field="secure" ${rowData.secure ? "checked" : ""} />
  </div>

  <div class="expand-row disabled">
    <label>Size</label>
    <input value="${sizeBytes} bytes" disabled />
  </div>

  <div class="expand-row disabled">
    <label>Session</label>
    <input value="${rowData.session ? "Yes" : "No"}" disabled />
  </div>

  <div class="expand-row">
    <label>HttpOnly</label>
    <input type="checkbox" data-field="httpOnly" ${rowData.httpOnly ? "checked" : ""} />
  </div>

  <div class="expand-row disabled">
    <label>Cross-Site</label>
    <input value="${rowData.sameSite === "no_restriction" ? "Yes" : "Restricted"}" disabled />
  </div>

  <div class="expand-row disabled">
    <label>Expires</label>
    <input value="${rowData.expirationDate ? new Date(rowData.expirationDate * 1000).toLocaleString() : "Session"}" disabled />
  </div>

  <div class="expand-row disabled">
    <label>Partitioned</label>
    <input type="checkbox" disabled ${rowData.partitioned ? "checked" : ""} />
  </div>

  <div class="expand-row">
    <label>SameSite</label>
    <select data-field="sameSite">
      <option value="no_restriction" ${rowData.sameSite === "no_restriction" ? "selected" : ""}>No Restriction</option>
      <option value="lax" ${rowData.sameSite === "lax" ? "selected" : ""}>Lax</option>
      <option value="strict" ${rowData.sameSite === "strict" ? "selected" : ""}>Strict</option>
    </select>
  </div>

  <div class="expand-row">
    <label>Max-Age (sec)</label>
    <input type="number" data-field="maxAge" placeholder="Session" />
  </div>

  <div class="expand-actions">
    <button class="cancel">Cancel</button>
    <button class="reset">Reset</button>
    <button class="save-row">
      ${isNew ? "Create Cookie" : "Save Changes"}
    </button>
  </div>
`

        const original = JSON.parse(JSON.stringify(rowData))
        const nameInput = expand.querySelector('[data-field="name"]')
        const scopeSelect = expand.querySelector('[data-field="domainScope"]')

        const chain = this.buildDomainChain(this.currentHost)
        const currentHost = this.currentHost

        const secureRow = expand.querySelector('[data-field="secure"]').closest(".expand-row")
        const pathRow = expand.querySelector('[data-field="path"]').closest(".expand-row")
        const scopeRow = scopeSelect.closest(".expand-row")

        const setInfo = (rowEl, message) => {
            let icon = rowEl.querySelector(".info-icon")

            if (!icon) {
                icon = document.createElement("span")
                icon.className = "info-icon"
                icon.textContent = "i"
                rowEl.querySelector("label").appendChild(icon)
            }

            icon.title = message
            icon.style.display = "inline-flex"
        }

        const clearInfo = rowEl => {
            const icon = rowEl.querySelector(".info-icon")
            if (icon) icon.style.display = "none"
        }

        const getPrefixType = name => {
            if (name.startsWith("__Host-")) return "host"
            if (name.startsWith("__Secure-")) return "secure"
            return null
        }

        const showPrefixBanner = type => {
            const banner = expand.querySelector(".security-banner")
            banner.style.display = "block"

            if (type === "secure") {
                banner.textContent =
                    "__Secure- cookies must be sent over HTTPS and always require the Secure flag. These fields are locked to prevent browser rejection."
            }

            if (type === "host") {
                banner.textContent =
                    "__Host- cookies require Secure, Path=/, and exact host scope. Domain changes are blocked by browser security rules."
            }
        }

        const applyPrefixRules = name => {
            const type = getPrefixType(name)
            const banner = expand.querySelector(".security-banner")

            banner.style.display = "none"
            banner.textContent = ""

            secureRow.classList.remove("disabled")
            pathRow.classList.remove("disabled")
            scopeRow.classList.remove("disabled")

            clearInfo(secureRow)
            clearInfo(pathRow)
            clearInfo(scopeRow)

            expand.querySelector('[data-field="secure"]').disabled = false
            expand.querySelector('[data-field="path"]').disabled = false
            scopeSelect.disabled = false

            if (!type) return

            expand.querySelector('[data-field="secure"]').checked = true
            expand.querySelector('[data-field="secure"]').disabled = true
            secureRow.classList.add("disabled")

            setInfo(
                secureRow,
                "This field is locked because cookies with __Secure- or __Host- prefixes must always use the Secure flag (RFC 6265bis)."
            )

            if (type === "host") {
                expand.querySelector('[data-field="path"]').value = "/"
                expand.querySelector('[data-field="path"]').disabled = true
                pathRow.classList.add("disabled")

                setInfo(
                    pathRow,
                    "__Host- cookies must always use Path=/ and cannot be scoped to sub-paths."
                )

                scopeSelect.value = currentHost
                scopeSelect.disabled = true
                scopeRow.classList.add("disabled")

                setInfo(
                    scopeRow,
                    "__Host- cookies cannot define a Domain attribute and must be bound to the exact host."
                )
            }

            showPrefixBanner(type)
        }

        nameInput.addEventListener("input", e => {
            applyPrefixRules(e.target.value)
        })

        if (chain.length === 0) {
            const opt = document.createElement("option")
            opt.value = this.currentHost
            opt.textContent = this.currentHost
            scopeSelect.appendChild(opt)
            scopeSelect.disabled = true
        } else if (chain.length === 1) {
            scopeSelect.innerHTML = `<option value="${this.escapeAttr(chain[0])}">${chain[0]}</option>`
            scopeSelect.disabled = true
        } else {
            chain.forEach(domain => {
                const opt = document.createElement("option")
                opt.value = domain
                opt.textContent = domain
                scopeSelect.appendChild(opt)
            })
        }

        const currentDomain = rowData.domain || this.currentHost
        const matchedScope = chain.find(d => d.replace(/^\./, "") === String(currentDomain).replace(/^\./, ""))
        scopeSelect.value = matchedScope || chain[0] || this.currentHost

        applyPrefixRules(rowData.name || "")

        expand.querySelector(".reset").onclick = () => {
            expand.querySelectorAll("[data-field]").forEach(el => {
                const key = el.dataset.field
                if (el.type === "checkbox") {
                    el.checked = Boolean(original[key])
                } else {
                    el.value = original[key] || ""
                }
            })

            const restored = chain.find(d => d.replace(/^\./, "") === String(original.domain || "").replace(/^\./, ""))
            if (restored) scopeSelect.value = restored

            applyPrefixRules(expand.querySelector('[data-field="name"]').value)
        }

        expand.querySelector(".cancel").onclick = () => {
            if (isNew) {
                this.data = this.data.filter(item => item !== rowData)
                this.draw()
                return
            }

            expand.remove()
            toggleCell.textContent = ">"
        }

        expand.querySelector(".save-row").onclick = async () => {
            const payload = {}

            expand.querySelectorAll("[data-field]").forEach(el => {
                if (el.type === "checkbox") {
                    payload[el.dataset.field] = el.checked
                } else {
                    payload[el.dataset.field] = el.value
                }
            })

            payload.domain = scopeSelect.value

            if (!payload.name) {
                await this.showCustomAlert("Cookie name is required")
                return
            }

            if (isNew) {
                await this.handlers.onCreate(payload)
                return
            }

            const updated = { ...rowData, ...payload }

            await this.handlers.onEdit({
                original,
                updated
            })
        }

        return expand
    }

    createWebStorageExpand(row, rowData, toggleCell) {
        const isNew = rowData.__new === true
        const expand = document.createElement("div")
        expand.className = "grid-expand"
        expand.style.display = "flex"
        expand.style.flexDirection = "column"

        const escapedKey = this.escapeAttr(rowData.key || "")
        const escapedValue = this.escapeAttr(rowData.value || "")

        expand.innerHTML = `
  <div class="expand-row">
    <label>Key</label>
    <input value="${escapedKey}" data-field="key" />
  </div>

  <div class="expand-row">
    <label>Value</label>
    <input value="${escapedValue}" data-field="value" />
  </div>

  <div class="expand-row disabled">
    <label>Size</label>
    <input data-field="size" disabled />
  </div>

  <div class="expand-actions">
    <button class="cancel">Cancel</button>
    <button class="reset">Reset</button>
    <button class="save-row">
      ${isNew ? "Create Item" : "Save Changes"}
    </button>
  </div>
`

        const original = JSON.parse(JSON.stringify(rowData))
        const keyInput = expand.querySelector('[data-field="key"]')
        const valueInput = expand.querySelector('[data-field="value"]')
        const sizeInput = expand.querySelector('[data-field="size"]')

        const updateSize = () => {
            sizeInput.value = `${new Blob([valueInput.value || ""]).size} bytes`
        }

        valueInput.addEventListener("input", updateSize)
        updateSize()

        expand.querySelector(".reset").onclick = () => {
            keyInput.value = original.key || ""
            valueInput.value = original.value || ""
            updateSize()
        }

        expand.querySelector(".cancel").onclick = () => {
            if (isNew) {
                this.data = this.data.filter(item => item !== rowData)
                this.draw()
                return
            }

            expand.remove()
            toggleCell.textContent = ">"
        }

        expand.querySelector(".save-row").onclick = async () => {
            const updated = {
                ...rowData,
                key: keyInput.value.trim(),
                value: valueInput.value || ""
            }

            if (!updated.key) {
                await this.showCustomAlert("Storage key is required")
                return
            }

            if (isNew) {
                await this.handlers.onCreate({
                    key: updated.key,
                    value: updated.value
                })
                return
            }

            await this.handlers.onEdit({
                original,
                updated
            })
        }

        return expand
    }

    enableTooltip(cell, rowData) {
        let raf

        cell.onmouseenter = e => {
            cancelAnimationFrame(raf)
            raf = requestAnimationFrame(() => {
                this.tooltip.style.display = "block"
                this.tooltip.style.left = e.clientX + 10 + "px"
                this.tooltip.style.top = e.clientY + 10 + "px"
                this.tooltip.textContent = JSON.stringify(rowData, null, 2)
            })
        }

        cell.onmousemove = e => {
            this.tooltip.style.left = e.clientX + 10 + "px"
            this.tooltip.style.top = e.clientY + 10 + "px"
        }

        cell.onmouseleave = () => {
            cancelAnimationFrame(raf)
            this.tooltip.style.display = "none"
        }
    }

    enableResize(cell, col) {
        const handle = document.createElement("div")
        handle.className = "resize-handle"
        cell.appendChild(handle)

        let startX
        let startWidth

        handle.onmousedown = e => {
            e.preventDefault()
            startX = e.clientX
            startWidth = cell.offsetWidth

            document.onmousemove = e2 => {
                const delta = e2.clientX - startX
                const newWidth = Math.max(col.minWidth || 80, startWidth + delta)

                col.width = newWidth

                const index = this.schema.columns.indexOf(col)
                this.container.querySelectorAll(".grid-row, .grid-header").forEach(row => {
                    const target = row.children[index]
                    if (target) {
                        target.style.flex = `0 0 ${newWidth}px`
                    }
                })
            }

            document.onmouseup = () => {
                document.onmousemove = null
                document.onmouseup = null
            }
        }
    }

    filter(query) {
        const q = (query || "").toLowerCase()

        if (!q) {
            this.data = this.allData.slice()
            this.draw()
            return
        }

        const filtered = this.allData.filter(row =>
            this.schema.columns.some(col => {
                if (col.id === "actions" || col.id === "expand") return false
                const val = String(row[col.id] || "").toLowerCase()
                return val.includes(q)
            })
        )

        this.data = filtered
        this.draw()
    }
}
