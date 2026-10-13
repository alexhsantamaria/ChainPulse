// Infraestructura (solo para las herramientas de scripts/) -- chequeo
// de relaciones que podrian sufrir CASCADE o SET NULL al borrar la
// empresa/usuarios de prueba (Alex, 2026-10-04, punto 1 de la segunda
// correccion: "Borrar explícitamente la empresa no evita sus cascadas").
//
// Dos categorias, segun prisma/schema.prisma:
//
// 1. MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA -- el resto de
//    TENANT_SCOPED_MODELS (ver src/infra/prisma/tenantScope.ts), todos
//    con onDelete: Cascade DESDE Empresa. Borrar la empresa de prueba
//    los cascadearia igual que a los usuarios, asi que si hay alguna
//    fila bajo esta empresaId en cualquiera de ellos, NO es dato de
//    prueba esperado (la siembra solo crea Empresa + 4 Usuario) --
//    aborta en vez de dejar que el cascade se la lleve en silencio.
//
// 2. MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT -- relaciones que
//    cascadean o anulan DESDE Usuario (CASCADE o SET NULL) y que el
//    chequeo de la categoria 1 no cubre de forma confiable, porque la
//    fila riesgosa puede no estar bajo la empresaId de la prueba:
//    RespuestaCruda.responsableId y MetricaCuestionario.responsableId
//    y RecomendacionEjecutada.marcadaPorId (tablas sin empresaId
//    propio, onDelete: Cascade DESDE Usuario); ConsentimientoCuenta.
//    usuarioId (SI tiene empresaId y ya esta en la categoria 1, pero
//    se repite aca como defensa adicional por si una fila con
//    empresaId distinto igual apuntara a un id de usuario de esta
//    corrida); e ImportacionCsv.confirmadaPorId (SI tiene empresaId y
//    ya esta en la categoria 1 tambien, pero el riesgo real es
//    justamente una fila de OTRA empresa -- una importacion que no es
//    de prueba -- cuyo confirmadaPorId apunte a un usuario de prueba;
//    ver la correccion debajo). En los tres casos se buscan por los
//    ids exactos de los 4 usuarios del manifiesto, sin importar la
//    empresa de la fila encontrada.
//
// CORRECCION (Alex, 2026-10-04, revision de la version c): el
// comentario anterior afirmaba que ImportacionCsv.confirmadaPorId no
// tenia onDelete declarado y que por eso Postgres aplicaba RESTRICT
// por default. Eso era incorrecto en dos sentidos: el modelo es
// ImportacionCsv (no ObservacionCobertura), y la migracion real
// (prisma/migrations/20260924040000_incremento4_kpis_bloque_b_cobertura/
// migration.sql, linea 87) declara explicitamente:
//
//   ALTER TABLE "importaciones_csv" ADD CONSTRAINT
//   "importaciones_csv_confirmadaPorId_fkey" FOREIGN KEY
//   ("confirmadaPorId") REFERENCES "usuarios"("id") ON DELETE SET NULL
//   ON UPDATE CASCADE;
//
// Para un campo de relacion OPCIONAL (confirmadaPorId String? en el
// schema) Prisma genera SET NULL por default cuando el modelo no
// declara onDelete explicitamente -- no RESTRICT/NO ACTION, que es el
// default solo para relaciones obligatorias. SET NULL es ademas mas
// peligroso que un RESTRICT: no hace fallar el DELETE ni la
// transaccion, simplemente pone confirmadaPorId en null en silencio --
// borrar un usuario de prueba podria desprender asi, sin ningun error,
// el rastro de auditoria ("quien confirmo esta importacion") de un CSV
// real de otra empresa. Por eso ahora SI esta en la segunda categoria,
// MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT, buscado por los ids de
// usuario sin restriccion de empresaId -- igual que las demas de esa
// lista, y con la misma razon: una importacion de OTRA empresa puede
// legitimamente referenciar a un usuario de prueba como confirmadaPorId
// si, por ejemplo, un id se reutilizara entre corridas (motivo exacto
// por el que la busqueda no se limita a la empresaId de la prueba).
import { logError } from "../log";

export const MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA = [
  "eslabon",
  "conexion",
  "cicloPulso",
  "consentimientoCuenta",
  "cadena",
  "nodo",
  "conexionCadena",
  "hallazgoCadena",
  "respuestaCadena",
  "observacionKpi",
  "observacionCobertura",
  "importacionCsv",
] as const;

export const MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT = [
  { modelo: "respuestaCruda", campo: "responsableId" },
  { modelo: "metricaCuestionario", campo: "responsableId" },
  { modelo: "recomendacionEjecutada", campo: "marcadaPorId" },
  { modelo: "consentimientoCuenta", campo: "usuarioId" },
  { modelo: "importacionCsv", campo: "confirmadaPorId" },
] as const;

interface AccesoConteo {
  count(args: { where: Record<string, unknown> }): Promise<number>;
}

// Indexado por nombre de modelo (en minuscula-camel, como los expone el
// cliente de Prisma) -- tipado laxo a proposito para que las pruebas
// puedan armar un mock con un objeto literal comun, sin tener que
// implementar una interfaz con 15 miembros obligatorios.
export interface ClienteRelacionesCascada {
  [modelo: string]: AccesoConteo;
}

async function contarSeguro(
  cliente: ClienteRelacionesCascada,
  modelo: string,
  where: Record<string, unknown>,
  contexto: string,
): Promise<number> {
  try {
    return await cliente[modelo]!.count({ where });
  } catch {
    // catch SIN binding -- nunca reenvia el error real de Postgres.
    logError(contexto, "ERROR_CONSULTA_RELACIONES_CASCADA");
    throw new Error("ERROR_CONSULTA_RELACIONES_CASCADA");
  }
}

/**
 * Aborta si encuentra CUALQUIER dato bajo la empresa/usuarios de prueba
 * en una tabla que la siembra nunca crea -- ver las dos categorias en
 * el comentario de cabecera. Nunca muta nada; se llama ANTES de borrar
 * usuarios/empresa, dentro de la misma transaccion que el borrado
 * (proteccion frente a cambios concurrentes, punto 1).
 */
export async function verificarSinDatosRelacionadosInesperados(
  cliente: ClienteRelacionesCascada,
  empresaId: string,
  idsUsuarios: string[],
  contexto: string,
): Promise<void> {
  for (const modelo of MODELOS_TENANT_SIN_USUARIO_NI_EMPRESA) {
    const cantidad = await contarSeguro(cliente, modelo, { empresaId }, contexto);
    if (cantidad > 0) {
      const codigo = `DATOS_RELACIONADOS_INESPERADOS_EN_${modelo.toUpperCase()}`;
      logError(contexto, codigo);
      throw new Error(codigo);
    }
  }

  for (const { modelo, campo } of MODELOS_CASCADA_USUARIO_FUERA_DE_TENANT) {
    const cantidad = await contarSeguro(cliente, modelo, { [campo]: { in: idsUsuarios } }, contexto);
    if (cantidad > 0) {
      const codigo = `DATOS_RELACIONADOS_INESPERADOS_EN_${modelo.toUpperCase()}`;
      logError(contexto, codigo);
      throw new Error(codigo);
    }
  }
}
