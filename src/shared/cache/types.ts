export type Logger = (event: string, data?: Record<string, unknown>) => void;

/**
 * Contrato de cache usado por el resto de la app. Por diseno, NINGUN metodo lanza:
 * un fallo de Redis se traduce en "no habia nada en cache", nunca en una excepcion
 * que tumbe el request. Eso es lo que permite la degradacion elegante.
 */
export interface Cache {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  /** Lee un contador entero: 0 si no existe, `undefined` si el cache no esta disponible. */
  counter(key: string): Promise<number | undefined>;
  /** Incrementa un contador y devuelve el nuevo valor, o `undefined` si el cache fallo. */
  incr(key: string): Promise<number | undefined>;
  ping(): Promise<boolean>;
}
