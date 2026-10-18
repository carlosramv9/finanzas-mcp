/**
 * Aplica las migraciones pendientes de db/migrations.
 *   npm run db:migrate            -> usa DATABASE_URL
 *   npm run db:migrate -- --test  -> usa DATABASE_URL_TEST
 */
import { fileURLToPath } from "node:url";
import { aplicarMigraciones } from "../src/db/migraciones";

const usarPrueba = process.argv.includes("--test");
const variable = usarPrueba ? "DATABASE_URL_TEST" : "DATABASE_URL";
const url = process.env[variable];

if (!url) {
  console.error(`Falta la variable de entorno ${variable}.`);
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
