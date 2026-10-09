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
  ping(): Promise<boolean>;
}
