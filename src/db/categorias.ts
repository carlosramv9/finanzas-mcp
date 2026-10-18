import type { Db } from "./cliente";

export interface Categoria {
  nombre: string;
  es_ingreso: boolean;
}

export async function listarCategorias(db: Db): Promise<Categoria[]> {
  const filas = await db.consultar<{ nombre: string; es_ingreso: boolean }>({
    texto: "SELECT nombre, es_ingreso FROM categorias ORDER BY es_ingreso, nombre",
  });
  return filas.map((f) => ({ nombre: f.nombre, es_ingreso: Boolean(f.es_ingreso) }));
}

const normalizar = (texto: string) =>
  texto.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toLowerCase();

/**
 * Busca la categoría sin distinguir mayúsculas ni acentos y devuelve su nombre
 * canónico ("nomina" -> "Nómina"), o `undefined` si no existe.
 */
export function resolverCategoria(categorias: Categoria[], nombre: string): string | undefined {
  const buscada = normalizar(nombre);
  return categorias.find((c) => normalizar(c.nombre) === buscada)?.nombre;
}

export function mensajeCategoriaInexistente(categorias: Categoria[], nombre: string): string {
  return (
    `La categoría '${nombre}' no existe. Categorías válidas: ` +
    categorias.map((c) => c.nombre).join(", ") +
    "."
  );
}
