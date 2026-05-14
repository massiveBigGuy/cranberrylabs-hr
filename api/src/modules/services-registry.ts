/**
 * A minimal service registry for cross-module sharing.
 *
 * Some modules need handles owned by others — the sources router needs the
 * scrape queue, which is owned by the scraper module. We could solve this
 * with import cycles or singletons; instead, the loader passes an empty
 * registry into each module's init hook, and modules `register` and `get`
 * services by name.
 *
 * Why a Map instead of a typed struct: types are stronger but require
 * upfront declaration. A Map keyed by name lets new modules register new
 * services without amending shared types. It's still type-safe at the call
 * site via the generic.
 */

export type ServiceKey = string;

export class ServiceRegistry {
  private readonly entries = new Map<ServiceKey, unknown>();

  register<T>(key: ServiceKey, value: T): void {
    if (this.entries.has(key)) {
      throw new Error(`service '${key}' is already registered`);
    }
    this.entries.set(key, value);
  }

  /**
   * Get a service. Throws if missing — callers should rely on the loader's
   * deterministic init order to ensure dependencies are registered first.
   */
  get<T>(key: ServiceKey): T {
    if (!this.entries.has(key)) {
      throw new Error(`service '${key}' is not registered`);
    }
    return this.entries.get(key) as T;
  }

  /**
   * Lazy getter — for modules that need to read a service that's
   * registered later in the init order. Resolves the value at call time,
   * not capture time.
   */
  lazy<T>(key: ServiceKey): () => T {
    return () => this.get<T>(key);
  }

  has(key: ServiceKey): boolean {
    return this.entries.has(key);
  }
}
