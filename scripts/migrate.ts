/**
 * Aplica las migraciones pendientes de db/migrations.
 *   npm run db:migrate            -> usa DATABASE_URL_UNPOOLED o, si no existe, DATABASE_URL
 *   npm run db:migrate -- --test  -> usa DATABASE_URL_TEST
 *
 * Se prefiere la conexión directa (sin pooler): el advisory lock es de sesión
 * y PgBouncer en modo transacción no garantiza la misma sesión.
 */
import { fileURLToPath } from "node:url";
import { aplicarMigraciones } from "../src/db/migraciones";

const candidatas = process.argv.includes("--test")
  ? ["DATABASE_URL_TEST"]
  : ["DATABASE_URL_UNPOOLED", "DATABASE_URL"];
const variable = candidatas.find((v) => process.env[v]);
const url = variable && process.env[variable];

if (!variable || !url) {
  console.error(`Falta la variable de entorno ${candidatas.join(" o ")}.`);
  process.exit(1);
}

const directorio = fileURLToPath(new URL("../db/migrations", import.meta.url));

try {
  console.log(`Migrando base de datos (${variable})...`);
  const aplicadas = await aplicarMigraciones(url, directorio, console.log);
  console.log(`Listo. ${aplicadas.length} migración(es) aplicada(s).`);
} catch (error) {
  // Solo el mensaje: nunca imprimir la cadena de conexión.
  console.error((error as Error).message);
  process.exit(1);
}
