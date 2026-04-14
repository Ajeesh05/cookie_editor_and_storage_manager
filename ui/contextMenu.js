export function showContextMenu(x, y, items) {
    const existing = document.querySelector('.context-menu')
    if (existing) existing.remove()

    const menu = document.createElement("div")
    menu.className = "context-menu"
    menu.style.left = x + "px"
    menu.style.top = y + "px"

    items.forEach(item => {
        const entry = document.createElement("div")
        entry.textContent = item.label
        entry.onclick = e => {
            e.stopPropagation()
            item.action()
            menu.remove()
        }
        menu.appendChild(entry)
    })

    document.body.appendChild(menu)

    const close = () => {
        menu.remove()
        document.removeEventListener('click', close)
        document.removeEventListener('contextmenu', close)
        window.removeEventListener('blur', close)
    }

    setTimeout(() => {
        document.addEventListener('click', close)
        document.addEventListener('contextmenu', close)
        window.addEventListener('blur', close)
    }, 0)
}