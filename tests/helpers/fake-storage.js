/** Minimal Web Storage implementation, enough for the injected functions. */
export class FakeStorage {
  constructor(initial = {}) {
    this.map = new Map(Object.entries(initial))
  }

  get length() {
    return this.map.size
  }

  key(i) {
    return [...this.map.keys()][i] ?? null
  }

  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null
  }

  setItem(k, v) {
    this.map.set(String(k), String(v))
  }

  removeItem(k) {
    this.map.delete(k)
  }
}
