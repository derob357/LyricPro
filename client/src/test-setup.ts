// Vitest client test setup
// Provides a proper localStorage/sessionStorage implementation for tests
// that run under @edge-runtime/vm which only provides a stub.

class InMemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.has(key) ? (this.store.get(key) as string) : null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, value);
  }
}

// Replace stub localStorage/sessionStorage with proper implementations
// so tests that call localStorage.clear() / .setItem() / .getItem() work.
if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: new InMemoryStorage(),
    writable: true,
  });
  Object.defineProperty(window, "sessionStorage", {
    value: new InMemoryStorage(),
    writable: true,
  });
}
