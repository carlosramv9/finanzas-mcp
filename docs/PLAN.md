# Plan de implementación — finanzas-mcp

Aprobado el 2026-10-18. Referencia de requisitos: [`CLAUDE.md`](../CLAUDE.md).

## Decisiones tomadas

- **Adaptador MCP:** [`mcp-handler`](https://github.com/vercel/mcp-handler) v2 (mantenido por Vercel,
  sucesor de `@vercel/mcp-adapter`), sobre `@modelcontextprotocol/server` v2 y `zod` v4.
  - Solo Streamable HTTP, sin estado, sin Redis. Sin SSE.
  - Soporta la especificación MCP 2026-07-28 y hace fallback para clientes 2025.
  - El handler no inspecciona la ruta: se monta en `app/api/mcp/[secreto]/route.ts`.
  - Para fase 2 (OAuth) ofrece `withMcpAuth` + `protectedResourceHandler` (RFC 9728).
- **Ramas:** una por fase (`fase-1-base`, `fase-2-herramientas`, `fase-3-endpoint`,
  `fase-4-despliegue`), cada una a partir de la anterior, con commits pequeños.
- **Autenticación como capa separada:** las herramientas y el servidor MCP no saben nada de
  autenticación; la ruta compone `autenticación(handler)`.

## Fase 1 — Proyecto base, migración SQL y `db:migrate`

| Archivo | Propósito |
|---|---|
| `package.json` | Scripts `dev`, `build`, `typecheck`, `test`, `test:integration`, `db:migrate` |
| `tsconfig.json` | TypeScript estricto |
| `next.config.ts` | Configuración de Next.js |
| `.gitignore` | Ignora `.env*` salvo `.env.example` |
| `.env.example` | `DATABASE_URL`, `DATABASE_URL_TEST`, `MCP_PATH_SECRET` |
| `vitest.config.ts` | Configuración de pruebas |
| `db/migrations/001_init.sql` | Esquema inicial (exacto al de CLAUDE.md) |
| `scripts/migrate.ts` | Aplica migraciones pendientes; registra en `_migraciones`; cada una en transacción; `--test` usa `DATABASE_URL_TEST` |
| `src/db/cliente.ts` | Cliente Neon (HTTP para consultas simples, `Pool` para transacciones) |
| `tests/unit/migraciones.test.ts` | Lógica de detección de migraciones pendientes |

## Fase 2 — Validaciones zod y las 6 herramientas

| Archivo | Propósito |
|---|---|
| `src/validation/movimiento.ts` | monto > 0 y ≤ 2 decimales, fecha ISO 8601, `cuenta` = 4 dígitos, moneda ISO 4217 (default MXN), `id_correo` obligatorio si origen = correo |
| `src/validation/filtros.ts` | Rangos de fecha (`desde` ≤ `hasta`), `limite` (default 50, máx. 200) |
| `src/db/categorias.ts`, `src/db/movimientos.ts` | Consultas parametrizadas |
| `src/tools/respuesta.ts` | Helpers `ok()` / `error()` (texto + `structuredContent`, `isError`) |
| `src/tools/registrar-movimiento.ts` | `INSERT ... ON CONFLICT (id_correo) DO NOTHING` |
| `src/tools/registrar-movimientos-lote.ts` | Hasta 50; valida por índice; inserta válidos en una transacción |
| `src/tools/listar-movimientos.ts` | Filtros + ILIKE, fecha descendente |
| `src/tools/resumen-periodo.ts` | Totales, balance, desglose por categoría |
| `src/tools/actualizar-movimiento.ts` | Sin `id_correo`/`origen`; actualiza `actualizado_en` |
| `src/tools/listar-categorias.ts` | Categorías válidas |
| `src/tools/index.ts` | Registra todas las herramientas |
| `tests/unit/*.test.ts` | Validación y herramientas con BD simulada |
| `tests/integration/*.test.ts` | Contra `DATABASE_URL_TEST`: inserción, duplicado, lote mixto, resumen |

Cada herramienta recibe sus dependencias (`db`) inyectadas, declara anotaciones
(`readOnlyHint`, `destructiveHint`, `idempotentHint`) y `outputSchema`.

## Fase 3 — Endpoint MCP y autenticación de fase 1

| Archivo | Propósito |
|---|---|
| `src/servidor.ts` | `crearHandlerMcp()`: `createMcpHandler` + registro de herramientas |
| `src/auth/secreto-ruta.ts` | Envoltorio: compara secreto en tiempo constante (sha256 + `timingSafeEqual`), 404 si no coincide, exige ≥ 32 caracteres, nunca lo registra |
| `app/api/mcp/[secreto]/route.ts` | Compone auth + handler; exporta `GET`, `POST`, `DELETE` |
| `tests/unit/auth.test.ts` | Secreto correcto, incorrecto, de otra longitud, ausente |

Prueba local: `next dev` + `npx @modelcontextprotocol/inspector` contra
`http://localhost:3000/api/mcp/<secreto>`; smoke test con `curl` (`initialize`, `tools/list`).

## Fase 4 — Despliegue en Vercel

`docs/DESPLIEGUE.md`: conexión del repo, variables de entorno (URL de Neon con pooling),
generación del secreto, ejecución de migraciones, verificación externa y alta del conector
en claude.ai.

## Criterio de cierre de cada fase

`npm run typecheck` y `npm test` en verde → commit en la rama de la fase.
