// Infraestructura — RF20 §7.9: deteccion de la colision del INDICE
// PARCIAL uq_cuestionario_version_publicada (ON
// cuestionario_versiones(codigo) WHERE estado = 'PUBLICADA'), tal como
// llega al catch() de gobernanzaVersiones.ts despues de
// cliente.$queryRaw(publicar_cuestionario_version(...)).
//
// CORREGIDO (calibracion empirica -- ver
// scripts/rf20/calibrarExtractor23505RamaTemporal.ts): la version
// anterior de esta funcion asumia que cliente.$queryRaw produce el
// mismo error que cliente.model.create()/update() ante una violacion
// de restriccion unica -- code:"P2002" con meta.constraint.fields --.
// La calibracion contra una rama temporal de Neon demostro que eso es
// FALSO para esta ruta: ambas colisiones reales (la restriccion
// ordinaria @@unique([codigo, numero]) Y el indice parcial (codigo))
// llegaron con code DISTINTO de "P2002" y con
// meta.constraint.fields === null/undefined -- el extractor viejo
// nunca podia reconocer ninguna de las dos.
//
// Causa de fondo (confirmada por lectura directa del codigo fuente
// instalado de @prisma/client@6.19.3 y @prisma/adapter-pg@6.19.3, y
// corroborada por una reproduccion local real -- clases reales de
// @prisma/adapter-pg contra un pg.Pool sintetico, sin Neon, sin red --
// ejecutada como parte de esta correccion): Prisma traduce el SQLSTATE
// a un codigo "P2xxx" especifico (p.ej. P2002) SOLO para su API
// estructurada (model.create()/update()/etc.). Una consulta cruda
// ($queryRaw/$executeRaw -- que es como SIEMPRE se invoca
// publicar_cuestionario_version(), al ser una funcion SQL y no un
// modelo) nunca pasa por ese traductor especifico: cualquier fallo de
// $queryRaw se envuelve con el codigo GENERICO code:"P2010" ("Raw
// query failed"), y el detalle real queda en
// meta.driverAdapterError.cause (DriverAdapterError, de
// @prisma/driver-adapter-utils):
//   { kind: "UniqueConstraintViolation", originalCode: "23505",
//     constraint: { fields: [...nombres de columna] } }
//
// Limitacion CONOCIDA y deliberadamente aceptada de esta correccion:
// @prisma/adapter-pg@6.19.3 NUNCA expone, para SQLSTATE 23505, el
// nombre exacto de la restriccion/indice -- node-postgres SI lo
// entrega como error.constraint en su DatabaseError nativo (confirmado
// leyendo node_modules/pg y con la reproduccion local), pero
// mapDriverError() de adapter-pg lo descarta para este SQLSTATE en
// particular (a diferencia de 23503 -- violacion de FK --, donde SI
// propaga error.constraint como constraint.index). Lo unico que
// expone para 23505 son los NOMBRES DE COLUMNA, extraidos por la
// propia libreria con una expresion regular sobre el texto DETAIL de
// Postgres -- y el campo "constraint" esta ausente del todo si DETAIL
// no esta presente (p.ej. log_error_verbosity=terse). Por eso esta
// funcion compara, a falta de algo mejor, el CONJUNTO de columnas
// contra CAMPOS_INDICE_PARCIAL_PUBLICACION, nunca el nombre de la
// restriccion.
//
// AMBIGÜEDAD CONOCIDA (detectada durante esta correccion): existe un
// segundo indice parcial, en otra tabla totalmente distinta, con la
// MISMA firma de columnas: uq_definicion_kpi_publicada ON
// definicion_kpis(codigo) WHERE estado = 'PUBLICADA' (migracion
// 20260924020000_incremento4_kpis_bloque_a). Esta funcion es segura en
// su UNICO punto de uso actual (gobernanzaVersiones.ts, dentro del
// catch de la llamada a publicar_cuestionario_version(), que jamas
// puede fallar por una restriccion de definicion_kpis) -- pero NO debe
// reutilizarse para detectar una colision de columna "codigo" en
// ningun otro call site sin volver a verificar contra que tabla puede
// provenir el error en ese contexto.
//
// Compatibilidad conservada: si en algun momento futuro esta ruta SI
// entrega P2002 (otra version de la libreria, u otro call site que use
// la API estructurada en vez de $queryRaw), tambien se reconoce por
// esa forma clasica.
export const CAMPOS_INDICE_PARCIAL_PUBLICACION = ["codigo"] as const;

function camposCoincidenExactamente(campos: unknown, esperados: readonly string[]): boolean {
  if (!Array.isArray(campos) || !campos.every((campo) => typeof campo === "string")) return false;
  if (campos.length !== esperados.length) return false;
  return JSON.stringify([...campos].sort()) === JSON.stringify([...esperados].sort());
}

type CausaDriverAdapter = {
  kind?: unknown;
  originalCode?: unknown;
  constraint?: { fields?: unknown };
};

export function esViolacionIndiceParcialPublicacion(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; meta?: unknown };

  // Forma clasica P2002 (API estructurada) -- compatibilidad. Nunca es
  // la forma real para $queryRaw en la version instalada, pero se
  // conserva por si la ruta de invocacion cambiara en el futuro.
  if (e.code === "P2002") {
    const metaEstructurado = e.meta as { constraint?: { fields?: unknown } } | undefined | null;
    return camposCoincidenExactamente(metaEstructurado?.constraint?.fields, CAMPOS_INDICE_PARCIAL_PUBLICACION);
  }

  // Forma REAL observada para $queryRaw/$executeRaw: meta.driverAdapterError.cause
  // con kind:"UniqueConstraintViolation" y originalCode:"23505".
  // Deliberadamente no se exige ademas code==="P2010" aqui: lo unico
  // que importa para identificar la colision es la causa reportada por
  // el driver adapter, y exigir tambien el codigo generico P2010
  // agregaria un punto de fragilidad si una version futura de Prisma
  // cambiara ese codigo envolvente sin cambiar la causa real.
  const meta = e.meta as { driverAdapterError?: { cause?: CausaDriverAdapter } } | undefined | null;
  const causa = meta?.driverAdapterError?.cause;
  if (!causa || typeof causa !== "object") return false;
  if (causa.kind !== "UniqueConstraintViolation" || causa.originalCode !== "23505") return false;

  return camposCoincidenExactamente(causa.constraint?.fields, CAMPOS_INDICE_PARCIAL_PUBLICACION);
}
