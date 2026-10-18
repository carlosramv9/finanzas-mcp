# Despliegue en Vercel

Guía para publicar el servidor MCP y conectarlo a claude.ai como conector personalizado.
Corresponde a la **fase 1 de autenticación** (secreto en la ruta).

## 1. Base de datos (Neon)

1. En Neon, conserva la rama **principal** para producción y crea una rama de
   **desarrollo** para las pruebas de integración (`DATABASE_URL_TEST`).
2. Copia de la rama principal:
   - La URL **con pooling** (host con `-pooler`) → `DATABASE_URL`.
   - La URL **directa** (sin `-pooler`) → `DATABASE_URL_UNPOOLED`, solo para migrar.
3. Aplica las migraciones desde tu máquina, con un `.env` que apunte a producción:

   ```bash
   npm run db:migrate
   ```

   Repite en la rama de desarrollo con `npm run db:migrate -- --test`. El script es
   idempotente: registra lo aplicado en `_migraciones` y solo corre lo pendiente.

> Si usas la integración de Neon del Marketplace de Vercel, esta crea `DATABASE_URL` y
> `DATABASE_URL_UNPOOLED` por ti. Verifica que `DATABASE_URL` sea la URL con pooling.

## 2. Generar el secreto de ruta

Al menos 32 caracteres aleatorios y seguros para URL (sin `/`, `+` ni `=`):

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

Guárdalo en tu gestor de contraseñas. No lo pegues en issues, commits ni chats.

## 3. Crear el proyecto en Vercel

1. En Vercel: **Add New → Project**, importa el repositorio `finanzas-mcp`.
   Vercel detecta Next.js; no cambies el comando de build (`next build`).
2. En **Settings → Environment Variables**, entorno **Production**:

   | Variable | Valor |
   |---|---|
   | `DATABASE_URL` | URL de Neon **con pooling** de la rama principal |
   | `MCP_PATH_SECRET` | El secreto generado en el paso 2 |
   | `ZONA_HORARIA` | Opcional, por defecto `America/Mexico_City` |

   No definas `DATABASE_URL_TEST` en Vercel.
3. Haz deploy de la rama `main` (Production).

Si `MCP_PATH_SECRET` falta o tiene menos de 32 caracteres, el endpoint responde `404` a
todo y deja un aviso en los logs (sin el valor). Si falta `DATABASE_URL`, las herramientas
responden `isError` con "El servidor no está configurado correctamente".

### Deployment Protection

Las *preview deployments* de Vercel suelen tener **Vercel Authentication** activada.
claude.ai no puede pasarla, así que conecta siempre el dominio de **producción**
(`<proyecto>.vercel.app`) y verifica en **Settings → Deployment Protection** que la
producción no esté protegida.

## 4. Verificar desde fuera

claude.ai se conecta desde la infraestructura de Anthropic, no desde tu máquina. Verifica
la URL pública de producción:

```bash
URL="https://<proyecto>.vercel.app/api/mcp/<MCP_PATH_SECRET>"

# initialize: debe responder 200 con serverInfo.name = "finanzas-mcp"
curl -s -X POST "$URL" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'

# Las 6 herramientas
npx @modelcontextprotocol/inspector --cli "$URL" --transport http --method tools/list

# Lectura real contra la BD de producción
npx @modelcontextprotocol/inspector --cli "$URL" --transport http \
  --method tools/call --tool-name listar_categorias

# Un secreto incorrecto debe dar 404
curl -s -o /dev/null -w "%{http_code}\n" -X POST "https://<proyecto>.vercel.app/api/mcp/incorrecto"
```

Revisa también **Logs** del proyecto en Vercel ante cualquier `isError` inesperado.

## 5. Conectar en claude.ai

1. Ve a **Customize → Connectors** (`https://claude.ai/customize/connectors`).
2. Pulsa **+ → Add custom connector**.
3. Nombre: `Finanzas`. URL: `https://<proyecto>.vercel.app/api/mcp/<MCP_PATH_SECRET>`.
   Deja vacía la configuración OAuth (fase 1).
4. En una conversación, activa el conector desde el botón **+** del chat. Prueba:
   "¿Qué categorías de gasto tengo?" (debe llamar a `listar_categorias`).

Referencia: [Connect to remote MCP servers](https://modelcontextprotocol.io/docs/2026-07-28/develop/connect-remote-servers).

## Consideraciones de seguridad (fase 1)

- **El secreto viaja en la URL.** Cualquiera que conozca la URL completa puede leer y
  escribir tus movimientos. La URL queda guardada en la configuración del conector y puede
  aparecer en los logs de peticiones de Vercel (el código propio nunca la registra).
  Esto es aceptable para pruebas; la fase 2 (OAuth 2.1) lo reemplaza.
- **Rotar el secreto:** genera uno nuevo → actualiza `MCP_PATH_SECRET` en Vercel →
  redeploy → edita la URL del conector en claude.ai. La URL anterior empezará a dar `404`.
- No hay herramienta de borrado. Las correcciones se hacen con `actualizar_movimiento`.

## Siguiente: fase 2 (OAuth)

`mcp-handler` incluye `withMcpAuth` y `protectedResourceHandler` (metadatos RFC 9728).
El cambio queda en la capa de auth: en `app/api/mcp/...` se reemplaza
`conSecretoDeRuta(crearHandlerMcp())` por `withMcpAuth(crearHandlerMcp(), verificarToken, …)`
y se agrega la ruta `/.well-known/oauth-protected-resource`. `src/servidor.ts` y
`src/tools/` no cambian.
