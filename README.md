# finanzas-mcp

Servidor MCP remoto (Streamable HTTP) para que Claude registre y consulte cargos y abonos
bancarios en PostgreSQL (Neon). Requisitos y decisiones: [`CLAUDE.md`](CLAUDE.md) y
[`docs/PLAN.md`](docs/PLAN.md). Despliegue: [`docs/DESPLIEGUE.md`](docs/DESPLIEGUE.md). Pendientes y fase 2:
[`docs/PENDIENTES.md`](docs/PENDIENTES.md).

## Herramientas

| Herramienta | Tipo |
|---|---|
| `registrar_movimiento` | Escritura (idempotente por `id_correo`) |
| `registrar_movimientos_lote` | Escritura, hasta 50, en una transacción |
| `listar_movimientos` | Solo lectura |
| `resumen_periodo` | Solo lectura |
| `actualizar_movimiento` | Escritura (sin cambiar `origen` ni `id_correo`) |
| `listar_categorias` | Solo lectura |

## Desarrollo local

Requiere Node 22 o superior (MCP Inspector pide 22.19+).

```bash
npm install
cp .env.example .env          # completar DATABASE_URL, DATABASE_URL_TEST y MCP_PATH_SECRET
npm run db:migrate            # aplica db/migrations en DATABASE_URL
npm run db:migrate -- --test  # idem en DATABASE_URL_TEST
npm run dev                   # http://localhost:3000
```

Generar un secreto de ruta (≥ 32 caracteres, seguro para URL):

```bash
node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"
```

## Pruebas

```bash
npm run typecheck
npm test                  # unitarias (BD simulada)
npm run test:integration  # contra DATABASE_URL_TEST; se omiten si no está definida
```

> Las pruebas de integración **vacían la tabla `movimientos`**. Usa siempre una rama de
> desarrollo de Neon, nunca la principal.

## Probar con MCP Inspector

Con `npm run dev` corriendo:

```bash
# Interfaz web: elegir transporte "Streamable HTTP" y pegar la URL
npx @modelcontextprotocol/inspector

# O en modo CLI
npx @modelcontextprotocol/inspector --cli "http://localhost:3000/api/mcp/<MCP_PATH_SECRET>" \
  --transport http --method tools/list

npx @modelcontextprotocol/inspector --cli "http://localhost:3000/api/mcp/<MCP_PATH_SECRET>" \
  --transport http --method tools/call --tool-name listar_categorias
```

Prueba rápida con `curl`:

```bash
curl -s -X POST "http://localhost:3000/api/mcp/<MCP_PATH_SECRET>" \
  -H "content-type: application/json" -H "accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"1"}}}'
```

Un secreto incorrecto responde `404`. `GET` responde `405`: el servidor es sin estado y no
abre streams SSE independientes.
