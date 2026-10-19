-- Estado de movimientos: completado (por defecto), pendiente, cancelado, rechazado.
-- Cancelado exige motivo. Solo los completados cuentan en totales.
-- Idempotente: en producción ya se aplicó desde la app (finanzas-app/db/migrations/005).

ALTER TABLE movimientos
  ADD COLUMN IF NOT EXISTS estado TEXT NOT NULL DEFAULT 'completado',
  ADD COLUMN IF NOT EXISTS motivo_estado TEXT,
  ADD COLUMN IF NOT EXISTS estado_actualizado_en TIMESTAMPTZ;

ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_estado_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_estado_check
  CHECK (estado IN ('completado', 'pendiente', 'cancelado', 'rechazado'));

ALTER TABLE movimientos DROP CONSTRAINT IF EXISTS movimientos_motivo_estado_check;
ALTER TABLE movimientos ADD CONSTRAINT movimientos_motivo_estado_check
  CHECK (
    (motivo_estado IS NULL OR length(btrim(motivo_estado)) BETWEEN 1 AND 500)
    AND (estado <> 'cancelado' OR length(btrim(coalesce(motivo_estado, ''))) >= 3)
  );

CREATE INDEX IF NOT EXISTS movimientos_no_completados_idx
  ON movimientos (estado, fecha DESC)
  WHERE estado <> 'completado';

CREATE OR REPLACE FUNCTION app_estado_movimiento()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF tg_op = 'INSERT' OR new.estado IS DISTINCT FROM old.estado THEN
    new.estado_actualizado_en := now();
  END IF;
  IF new.estado = 'completado' THEN
    new.motivo_estado := NULL;
  END IF;
  RETURN new;
END;
$$;

DROP TRIGGER IF EXISTS app_estado_movimiento ON movimientos;
CREATE TRIGGER app_estado_movimiento
  BEFORE INSERT OR UPDATE OF estado, motivo_estado ON movimientos
  FOR EACH ROW EXECUTE FUNCTION app_estado_movimiento();
