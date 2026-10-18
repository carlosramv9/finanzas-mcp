CREATE TABLE categorias (
  nombre      TEXT PRIMARY KEY,
  es_ingreso  BOOLEAN NOT NULL DEFAULT FALSE
);

INSERT INTO categorias (nombre, es_ingreso) VALUES
  ('Comida', false), ('Supermercado', false), ('Transporte', false),
  ('Gasolina', false), ('Servicios', false), ('Suscripciones', false),
  ('Salud', false), ('Entretenimiento', false), ('Compras', false),
  ('Hogar', false), ('Educación', false), ('Retiro de efectivo', false),
  ('Comisiones', false), ('Transferencia', false), ('Nómina', true),
  ('Otros', false);

CREATE TABLE movimientos (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  tipo          TEXT NOT NULL CHECK (tipo IN ('cargo', 'abono')),
  monto         NUMERIC(12,2) NOT NULL CHECK (monto > 0),
  moneda        CHAR(3) NOT NULL DEFAULT 'MXN',
  fecha         TIMESTAMPTZ NOT NULL,
  concepto      TEXT NOT NULL,
  categoria     TEXT NOT NULL REFERENCES categorias(nombre) ON UPDATE CASCADE,
  cuenta        TEXT,              -- solo últimos 4 dígitos
  origen        TEXT NOT NULL CHECK (origen IN ('correo', 'manual')),
  id_correo     TEXT UNIQUE,       -- ID del mensaje de Gmail, evita duplicados
  notas         TEXT,
  creado_en     TIMESTAMPTZ NOT NULL DEFAULT now(),
  actualizado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_movimientos_fecha ON movimientos (fecha DESC);
CREATE INDEX idx_movimientos_categoria_fecha ON movimientos (categoria, fecha DESC);
