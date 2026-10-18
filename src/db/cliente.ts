import { neon } from "@neondatabase/serverless";

/** Consulta parametrizada: texto con `$1`, `$2`, ... y sus valores. */
export interface Consulta {
  texto: string;
  valores?: unknown[];
}

export type Fila = Record<string, unknown>;

/**
 * Interfaz mínima de base de datos que usan las consultas y herramientas.
 * Permite inyectar un doble en pruebas unitarias sin tocar Neon.
 */
export interface Db {
  consultar<T extends Fila = Fila>(consulta: Consulta): Promise<T[]>;
  /** Ejecuta varias consultas en una sola transacción (todo o nada). */
  transaccion(consultas: Consulta[]): Promise<Fila[][]>;
}

/** Crea un `Db` sobre el driver HTTP de Neon (adecuado para serverless). */
export function crearDb(urlConexion: string): Db {
  const sql = neon(urlConexion);
  return {
    async consultar<T extends Fila = Fila>({ texto, valores = [] }: Consulta) {
      return (await sql.query(texto, valores)) as T[];
    },
    async transaccion(consultas) {
      if (consultas.length === 0) return [];
      return (await sql.transaction(
        consultas.map(({ texto, valores = [] }) => sql.query(texto, valores)),
      )) as Fila[][];
    },
  };
}

let dbPorDefecto: Db | undefined;

/** `Db` compartido del proceso, a partir de `DATABASE_URL`. */
export function obtenerDb(): Db {
  if (!dbPorDefecto) {
    const url = process.env.DATABASE_URL;
    if (!url) throw new Error("Falta la variable de entorno DATABASE_URL");
    dbPorDefecto = crearDb(url);
  }
  return dbPorDefecto;
}
