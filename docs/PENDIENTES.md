# Pendientes y fase 2

Estado al 2026-10-18. Fases 1 a 4 del [plan](PLAN.md) completadas y desplegadas en
producción (Vercel, rama `main`). Verificado desde fuera: `initialize`, `tools/list`,
`listar_categorias` contra la BD de producción y `404` con secreto incorrecto.

## Pendientes inmediatos

### Seguridad

- [ ] **Rotar `MCP_PATH_SECRET`.** El secreto actual quedó expuesto en una conversación.
  1. Generar uno nuevo: `node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"`.
  2. Actualizarlo en Vercel (Production) y redesplegar.
  3. Editar la URL del conector en claude.ai.
  4. Verificar que la URL anterior responda `404`.

### Pruebas

- [ ] **Pruebas de integración.** Nunca se han ejecutado contra Neon.
  1. Crear una rama de desarrollo en Neon y poner su URL en `DATABASE_URL_TEST` en `.env`.
  2. `npm run db:migrate -- --test`
  3. `npm run test:integration` (vacía `movimientos` en esa rama).
- [ ] **Prueba de extremo a extremo en claude.ai** (conector + Gmail):
  - [ ] `listar_categorias`
  - [ ] Gasto dictado (`registrar_movimiento`, origen `manual`)
  - [ ] Cuenta con número completo → rechazada / recortada a 4 dígitos
  - [ ] Categoría inexistente → error con lista de válidas
  - [ ] Notificaciones de Gmail en lote; repetir y confirmar que no duplica
  - [ ] `listar_movimientos` con filtros y búsqueda por texto
  - [ ] `resumen_periodo` del mes
  - [ ] `actualizar_movimiento` (categoría + notas)
- [ ] Limpiar datos de prueba en producción desde el SQL Editor de Neon
  (`DELETE ... WHERE id IN (...)` o `TRUNCATE movimientos RESTART IDENTITY`).

### Mudanza del repositorio

- [ ] Actualizar `repository.url` en `package.json` y el remoto (`git remote set-url origin ...`).
- [ ] Reconectar el proyecto de Vercel al nuevo repositorio (**Settings → Git**), o
  importarlo de nuevo. Si se importa de nuevo:
  - Verificar que el Framework Preset sea **Next.js** (`vercel.json` ya lo fija).
  - Volver a cargar `DATABASE_URL`, `MCP_PATH_SECRET` y `ZONA_HORARIA`.
  - La URL del proyecto puede cambiar: actualizar el conector de claude.ai.
- [ ] Borrar las ramas ya mergeadas (`fase-1-base` … `fase-4-despliegue`) si no se necesitan.

### Configuración y entorno

- [ ] Revisar en Vercel **Settings → Build and Deployment** que no quede un override de
  Output Directory (`public`) del primer intento de build.
- [ ] Actualizar Node local a ≥ 22.19 (MCP Inspector 2.11 lo pide; con 22.18 funciona con aviso).

## Mejoras sugeridas (no bloqueantes)

- **CI:** GitHub Actions con `npm run typecheck`, `npm test` y `npm run build` en cada PR.
  Opcional: `test:integration` con una rama efímera de Neon por PR.
- **Límite de peticiones:** rate limit básico por IP en el endpoint (p. ej. Vercel Firewall).
- **Búsqueda por texto:** si crece el volumen, índice `pg_trgm` para `concepto ILIKE`
  (nueva migración `002_...sql`).
- **Observabilidad:** usar `onEvent` de `mcp-handler` para métricas por herramienta
  (sin registrar argumentos, que contienen datos personales).
- **Categorías:** herramienta o migración para agregar categorías nuevas
  (hoy solo vía SQL).
- **App web (fase posterior):** Next.js leyendo la misma BD. Puede vivir en este proyecto
  reutilizando `src/db/`, con su propia autenticación.

## Limitaciones conocidas (por diseño)

- No hay herramienta de borrado; las correcciones se hacen con `actualizar_movimiento`.
- `GET` al endpoint responde `405`: el servidor es sin estado y no abre streams SSE.
- Las fechas sin hora se interpretan en `ZONA_HORARIA` (por defecto `America/Mexico_City`).
- `resumen_periodo` separa los totales por moneda; no convierte entre monedas.
- Fechas más de un día en el futuro se rechazan.

---

## Fase 2: OAuth 2.1

### Objetivo

Que claude.ai muestre el flujo de inicio de sesión y que el endpoint deje de depender de
un secreto en la URL. Usuario único (el dueño), así que basta un proveedor simple.

### Lo que dice la especificación y `mcp-handler`

- El servidor MCP es un **resource server**. Debe publicar *Protected Resource Metadata*
  (RFC 9728) en `/.well-known/oauth-protected-resource` indicando su servidor de
  autorización. Los clientes la usan para descubrirlo.
- Sin token o con uno inválido, el servidor responde `401` con un `WWW-Authenticate` que
  apunta a esos metadatos. Si al token le faltan scopes, responde `403`.
- Registro de clientes: la especificación 2026-07-28 prefiere los **Client ID Metadata
  Documents (CIMD)** y deja el *Dynamic Client Registration* (DCR) solo por
  compatibilidad. El servidor de autorización debe soportar al menos uno de los dos
  (anunciado con `client_id_metadata_document_supported` o `registration_endpoint`).
- `mcp-handler` **no incluye servidor de autorización**. Aporta:
  - `withMcpAuth(handler, verifyToken, { required, requiredScopes, resourceMetadataPath })`.
  - `verifyToken(req, bearerToken?) => AuthInfo | undefined`.
  - `protectedResourceHandler({ authServerUrls })` y `metadataCorsOptionsRequestHandler()`.
  - Las herramientas pueden leer `ctx.http?.authInfo` (no hace falta para un solo usuario).

### Decisión pendiente: servidor de autorización

| Opción | Ventajas | Desventajas |
|---|---|---|
| **Proveedor gestionado** (WorkOS AuthKit, Clerk, Auth0, Stytch…) con soporte MCP (CIMD/DCR) | Poco código, flujo de login listo, mantenimiento externo | Dependencia y cuenta externa; verificar plan gratuito y soporte CIMD/DCR |
| **Servidor propio mínimo** dentro de este Next.js (authorize/token/metadata, PKCE, un solo usuario) | Sin dependencias externas | Más código sensible a la seguridad que mantener; hay que implementar bien PKCE, expiración, rotación |

Recomendación inicial: **proveedor gestionado** que soporte CIMD (o DCR), con login
restringido al correo del dueño. Verificar la documentación vigente antes de elegir.

### Diseño

La fase 1 dejó la autenticación como capa separada, así que el cambio queda en la ruta:

```
app/
  api/mcp/route.ts                                # NUEVO: endpoint sin secreto en la ruta
  api/mcp/[secreto]/route.ts                      # se mantiene durante la transición, luego se elimina
  .well-known/oauth-protected-resource/route.ts   # NUEVO: metadatos RFC 9728
src/
  auth/oauth.ts                                   # NUEVO: verificarToken (firma JWT/JWKS, issuer, audience, exp, dueño)
  auth/secreto-ruta.ts                            # se elimina al terminar la transición
  servidor.ts, tools/                             # SIN CAMBIOS
```

```ts
// app/api/mcp/route.ts (esquema)
import { withMcpAuth } from "mcp-handler";
import { verificarToken } from "@/auth/oauth";
import { crearHandlerMcp } from "@/servidor";

const manejador = withMcpAuth(crearHandlerMcp(), verificarToken, { required: true });
export { manejador as GET, manejador as POST, manejador as DELETE };
```

```ts
// app/.well-known/oauth-protected-resource/route.ts (esquema)
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from "mcp-handler";

const handler = protectedResourceHandler({ authServerUrls: [process.env.OAUTH_ISSUER!] });
export { handler as GET, metadataCorsOptionsRequestHandler() as OPTIONS };
```

`verificarToken` debe:

- Validar la firma con el JWKS del proveedor (o introspección), además de `iss`, `aud`
  (la URL del recurso MCP) y `exp`.
- Aceptar solo al dueño (`sub` o correo en una lista permitida por variable de entorno).
- Devolver `undefined` ante cualquier fallo, sin registrar el token.

### Variables de entorno nuevas (tentativas)

- `OAUTH_ISSUER`: URL del servidor de autorización.
- `OAUTH_AUDIENCE`: identificador del recurso (URL pública de `/api/mcp`).
- `OAUTH_PROPIETARIO`: `sub` o correo autorizado.

### Pasos

1. Elegir el proveedor y verificar en su documentación vigente que soporte CIMD o DCR y
   el flujo de claude.ai (URL de callback del conector).
2. Implementar `src/auth/oauth.ts` con pruebas unitarias: token válido, firma inválida,
   `aud`/`iss` incorrectos, expirado, otro usuario, sin token → `401` con `WWW-Authenticate`.
3. Agregar `app/api/mcp/route.ts` y los metadatos `.well-known`.
4. Probar con MCP Inspector (soporta el flujo OAuth) en local y en un preview.
5. Desplegar, agregar en claude.ai un conector nuevo con `https://<proyecto>.vercel.app/api/mcp`
   y completar el inicio de sesión.
6. Cuando funcione, eliminar `app/api/mcp/[secreto]/`, `src/auth/secreto-ruta.ts`,
   `MCP_PATH_SECRET` y el conector antiguo.
7. Actualizar `CLAUDE.md`, `README.md` y `docs/DESPLIEGUE.md`.

### Referencias

- [mcp-handler: AUTHORIZATION.md](https://github.com/vercel/mcp-handler/blob/main/docs/AUTHORIZATION.md)
- [MCP: especificación de autorización](https://modelcontextprotocol.io/specification/latest/basic/authorization)
- [WorkOS: identidad de clientes MCP (DCR vs. CIMD)](https://workos.com/blog/mcp-client-identity-dcr-cimd-auth-md)
