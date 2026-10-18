import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { Pool } from "@neondatabase/serverless";

/** Nombre válido de migración: `NNN_descripcion.sql`. */
const PATRON_MIGRACION = /^\d{3}_[a-z0-9_]+\.sql$/;

/** Clave arbitraria del advisory lock que evita dos migraciones simultáneas. */
const CLAVE_BLOQUEO = 727_001;

export interface Migracion {
  nombre: string;
  sql: string;
}

/** Filtra y ordena los nombres de archivo que son migraciones. */
export function ordenarMigraciones(archivos: string[]): string[] {
  return archivos.filter((a) => PATRON_MIGRACION.test(a)).sort();
}

/** Migraciones aún no aplicadas, en orden. */
export function calcularPendientes(todas: string[], aplicadas: Iterable<string>): string[] {
  const yaAplicadas = new Set(aplicadas);
  return todas.filter((nombre) => !yaAplicadas.has(nombre));
}

export async function leerMigraciones(directorio: string): Promise<Migracion[]> {
  const nombres = ordenarMigraciones(await readdir(directorio));
  return Promise.all(
    nombres.map(async (nombre) => ({
      nombre,
      sql: await readFile(path.join(directorio, nombre), "utf8"),
    })),
  );
}

/**
 * Aplica las migraciones pendientes, cada una en su propia transacción, y las
 * registra en `_migraciones`. Devuelve los nombres aplicados.
 */
export async function aplicarMigraciones(
  urlConexion: string,
  directorio: string,
  registrar: (mensaje: string) => void = () => {},
): Promise<string[]> {
  const migraciones = await leerMigraciones(directorio);
  // Pool (WebSocket) en vez de HTTP: las migraciones tienen varias sentencias.
  const pool = new Pool({ connectionString: urlConexion });
  const cliente = await pool.connect();
  const aplicadasAhora: string[] = [];
  try {
    await cliente.query("SELECT pg_advisory_lock($1)", [CLAVE_BLOQUEO]);
    await cliente.query(`
      CREATE TABLE IF NOT EXISTS _migraciones (
        nombre      TEXT PRIMARY KEY,
        aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    const { rows } = await cliente.query<{ nombre: string }>("SELECT nombre FROM _migraciones");
    const pendientes = calcularPendientes(
      migraciones.map((m) => m.nombre),
      rows.map((r) => r.nombre),
    );
    if (pendientes.length === 0) registrar("No hay migraciones pendientes.");

    for (const nombre of pendientes) {
      const migracion = migraciones.find((m) => m.nombre === nombre)!;
      try {
        await cliente.query("BEGIN");
        await cliente.query(migracion.sql);
        await cliente.query("INSERT INTO _migraciones (nombre) VALUES ($1)", [nombre]);
        await cliente.query("COMMIT");
      } catch (error) {
        await cliente.query("ROLLBACK");
        throw new Error(`Falló la migración ${nombre}: ${(error as Error).message}`, {
          cause: error,
        });
      }
      aplicadasAhora.push(nombre);
      registrar(`Aplicada: ${nombre}`);
    }
  } finally {
    await cliente.query("SELECT pg_advisory_unlock($1)", [CLAVE_BLOQUEO]).catch(() => {});
    cliente.release();
    await pool.end();
  }
  return aplicadasAhora;
}
