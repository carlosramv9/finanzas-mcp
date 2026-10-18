\# finanzas-mcp



Servidor MCP remoto que permite a Claude (desde claude.ai como conector personalizado)

registrar y consultar cargos y abonos bancarios en una base de datos PostgreSQL en Neon.

Una app web separada (Next.js, fase posterior) consultará la misma base de datos.



\## Objetivo y alcance



\- Claude lee notificaciones bancarias (vía el conector de Gmail) o recibe gastos dictados

&#x20; por el usuario, y llama a las herramientas de este servidor para guardarlos.

\- El servidor expone herramientas ACOTADAS. Nunca SQL libre, nunca borrado masivo.

\- Toda validación vive en el servidor: no confiar en lo que mande el modelo.



\## Stack



\- TypeScript estricto (`"strict": true`), Node 20+.

\- Next.js (App Router) desplegado en Vercel, con el servidor MCP en una route handler.

\- SDK oficial de MCP para TypeScript (`@modelcontextprotocol/sdk`) con transporte

&#x20; \*\*Streamable HTTP\*\* (no SSE, está en desuso). Si existe un adaptador oficial o

&#x20; mantenido para Next.js/Vercel, úsalo; verifica la documentación actual antes de elegir.

\- `@neondatabase/serverless` para la conexión a Neon.

\- `zod` para validar entradas de herramientas.

\- `vitest` para pruebas.

\- Sin ORM por ahora: SQL parametrizado, consultas pequeñas y explícitas.



\## Esquema de base de datos



Crear como migración SQL versionada en `db/migrations/001\_init.sql`:



```sql

CREATE TABLE categorias (

&#x20; nombre      TEXT PRIMARY KEY,

&#x20; es\_ingreso  BOOLEAN NOT NULL DEFAULT FALSE

);



INSERT INTO categorias (nombre, es\_ingreso) VALUES

&#x20; ('Comida', false), ('Supermercado', false), ('Transporte', false),

&#x20; ('Gasolina', false), ('Servicios', false), ('Suscripciones', false),

&#x20; ('Salud', false), ('Entretenimiento', false), ('Compras', false),

&#x20; ('Hogar', false), ('Educación', false), ('Retiro de efectivo', false),

&#x20; ('Comisiones', false), ('Transferencia', false), ('Nómina', true),

&#x20; ('Otros', false);



CREATE TABLE movimientos (

&#x20; id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

&#x20; tipo          TEXT NOT NULL CHECK (tipo IN ('cargo', 'abono')),

&#x20; monto         NUMERIC(12,2) NOT NULL CHECK (monto > 0),

&#x20; moneda        CHAR(3) NOT NULL DEFAULT 'MXN',

&#x20; fecha         TIMESTAMPTZ NOT NULL,

&#x20; concepto      TEXT NOT NULL,

&#x20; categoria     TEXT NOT NULL REFERENCES categorias(nombre) ON UPDATE CASCADE,

&#x20; cuenta        TEXT,              -- solo últimos 4 dígitos

&#x20; origen        TEXT NOT NULL CHECK (origen IN ('correo', 'manual')),

&#x20; id\_correo     TEXT UNIQUE,       -- ID del mensaje de Gmail, evita duplicados

&#x20; notas         TEXT,

&#x20; creado\_en     TIMESTAMPTZ NOT NULL DEFAULT now(),

&#x20; actualizado\_en TIMESTAMPTZ NOT NULL DEFAULT now()

);



CREATE INDEX idx\_movimientos\_fecha ON movimientos (fecha DESC);

CREATE INDEX idx\_movimientos\_categoria\_fecha ON movimientos (categoria, fecha DESC);

```



Incluir un script `npm run db:migrate` que aplique las migraciones pendientes

(tabla `\_migraciones` para registrar las aplicadas).



\## Herramientas MCP



Nombres y descripciones en español: Claude los lee para decidir cuándo usarlas, así que

la descripción debe explicar claramente qué hace cada una y el formato de cada campo.

Declarar anotaciones (`readOnlyHint`, `destructiveHint`, `idempotentHint`) correctamente.



1\. \*\*registrar\_movimiento\*\*

&#x20;  - Entrada: `tipo` ('cargo' | 'abono'), `monto` (número > 0, máx. 2 decimales),

&#x20;    `fecha` (ISO 8601), `concepto` (1–200 caracteres), `categoria` (debe existir en

&#x20;    `categorias`), `cuenta` (opcional, exactamente 4 dígitos), `moneda` (opcional,

&#x20;    ISO 4217, default MXN), `origen` ('correo' | 'manual'), `id\_correo` (obligatorio si

&#x20;    origen = 'correo'), `notas` (opcional).

&#x20;  - Rechazar cualquier `cuenta` con más de 4 dígitos (nunca guardar números completos).

&#x20;  - `INSERT ... ON CONFLICT (id\_correo) DO NOTHING`; responder si se insertó o si ya

&#x20;    existía (idempotente).

&#x20;  - Devolver el movimiento creado con su `id`.



2\. \*\*registrar\_movimientos\_lote\*\*

&#x20;  - Igual que la anterior pero con un arreglo de hasta 50 movimientos, en una transacción.

&#x20;  - Devolver cuántos se insertaron, cuántos ya existían y los errores de validación por

&#x20;    índice (los válidos se insertan aunque otros fallen la validación).



3\. \*\*listar\_movimientos\*\*

&#x20;  - Entrada: `desde`, `hasta` (fechas ISO), `tipo`, `categoria`, `texto` (busca en

&#x20;    concepto, ILIKE), `limite` (default 50, máx. 200).

&#x20;  - Solo lectura. Ordenado por fecha descendente.



4\. \*\*resumen\_periodo\*\*

&#x20;  - Entrada: `desde`, `hasta`.

&#x20;  - Devuelve: total de cargos, total de abonos, balance, y desglose por categoría

&#x20;    (total y número de movimientos), ordenado de mayor a menor gasto.

&#x20;  - Solo lectura.



5\. \*\*actualizar\_movimiento\*\*

&#x20;  - Entrada: `id` y cualquiera de: `categoria`, `concepto`, `notas`, `fecha`, `monto`.

&#x20;  - No permite cambiar `id\_correo` ni `origen`. Actualiza `actualizado\_en`.



6\. \*\*listar\_categorias\*\*

&#x20;  - Solo lectura. Devuelve las categorías válidas para que Claude elija bien.



No implementar herramienta de borrado en esta fase.



Respuestas de herramientas: texto breve legible + datos estructurados (structuredContent

si el SDK lo soporta). Errores de validación como resultado de herramienta con

`isError: true` y un mensaje claro en español, no como excepción no controlada.



\## Autenticación (por fases)



\- \*\*Fase 1 (pruebas):\*\* el endpoint vive en `/api/mcp/\[secreto]`. El secreto viene de la

&#x20; variable de entorno `MCP\_PATH\_SECRET` (mínimo 32 caracteres aleatorios). Si no coincide,

&#x20; responder 404. Comparación en tiempo constante. Nunca registrar el secreto en logs.

\- \*\*Fase 2:\*\* OAuth 2.1 según la especificación de autorización de MCP, para que

&#x20; claude.ai muestre el flujo de inicio de sesión. Usuario único (el dueño), así que basta

&#x20; un proveedor simple. Diseñar la fase 1 de forma que agregar OAuth no obligue a

&#x20; reescribir las herramientas (autenticación como capa separada).



\## Variables de entorno



\- `DATABASE\_URL`: cadena de conexión de Neon (usar la URL con pooling).

\- `MCP\_PATH\_SECRET`: secreto de la ruta en fase 1.

\- Documentarlas en `.env.example`. Nunca commitear `.env`.



\## Estructura sugerida



```

app/api/mcp/\[secreto]/route.ts   # endpoint MCP

src/tools/                       # una herramienta por archivo

src/db/                          # cliente Neon y consultas

src/validation/                  # esquemas zod compartidos

db/migrations/

tests/

```



\## Pruebas



\- Unitarias de validación (montos, fechas, cuenta de 4 dígitos, categorías).

\- De integración contra una rama de Neon de desarrollo (no la principal), usando

&#x20; `DATABASE\_URL\_TEST`: inserción, duplicado por `id\_correo`, lote mixto, resumen.

\- Probar el servidor localmente con MCP Inspector antes de desplegar.



\## Despliegue



\- Vercel, conectado al repositorio. Variables de entorno en el panel de Vercel.

\- Después de desplegar, la URL del conector será

&#x20; `https://<proyecto>.vercel.app/api/mcp/<MCP\_PATH\_SECRET>`.

\- Verificar que el endpoint responda con Streamable HTTP desde fuera (claude.ai se

&#x20; conecta desde la infraestructura de Anthropic, no desde la máquina local).



\## Convenciones



\- Código y comentarios en español donde aporte claridad; identificadores en español

&#x20; consistentes con el esquema.

\- Commits pequeños por fase.

\- Antes de agregar una dependencia, verificar que esté mantenida.

