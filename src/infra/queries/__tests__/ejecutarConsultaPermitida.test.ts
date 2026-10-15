// Pruebas -- dispatcher central de Incremento 5 (I5-09..I5-13):
// construirConsultaPermitida() (pura) y ejecutarConsultaPermitida()
// (permisos, resolucion de cadena, despacho exhaustivo, auditoria).
// tenantClient() mockeado con un cliente FALSO en memoria (nunca
// Postgres real, mismo motivo que job.test.ts/importar.test.ts: "prisma
// generate" bloqueado en este entorno) -- las 6 preguntas corren con su
// motor REAL (engine/queries/*). Las pruebas de aceptacion end-to-end
// (I5-26 determinismo, I5-27 sin-datos, I5-29 separacion estructural)
// viven aparte, en aceptacionIncremento5.test.ts.
import { describe, expect, it, vi, beforeEach } from "vitest";
import { CATALOGO_CONSULTA_IDS, type CatalogoConsultaId } from "@/domain/queries/tipos";
import * as catalogoModule from "../catalogo";

const tenantClientMock = vi.fn();
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: (...args: unknown[]) => tenantClientMock(...args) }));

import { construirConsultaPermitida, ejecutarConsultaPermitida, type ResultadoEjecutarConsulta } from "../ejecutarConsultaPermitida";
import type { RespuestaConsulta } from "@/domain/queries/tipos";

const CONTEXTO = { empresaId: "empresa-1", usuarioId: "usuario-1", rol: "ADMINISTRADOR" as const };
const CADENA_ID = "cadena-1";
const PERIODO = { inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") };

const CATALOGOS_CON_PERIODO: ReadonlySet<CatalogoConsultaId> = new Set([
  "OTIF_CAIDA",
  "OTIF_PROVEEDOR_RETRASOS",
  "FALTANTES_FILL_RATE",
  "CAMBIOS_ULTIMO_PULSO",
]);

function entradaPara(catalogoId: CatalogoConsultaId) {
  return { catalogoId, cadenaId: CADENA_ID, periodo: CATALOGOS_CON_PERIODO.has(catalogoId) ? PERIODO : null };
}

function clienteBase() {
  return {
    cadena: { findUnique: vi.fn().mockResolvedValue({ id: CADENA_ID }) },
    definicionKpi: { findFirst: vi.fn().mockResolvedValue(null) },
    observacionKpi: { findFirst: vi.fn().mockResolvedValue(null) },
    conexionCadena: { findMany: vi.fn().mockResolvedValue([]) },
    hallazgoCadena: { findMany: vi.fn().mockResolvedValue([]) },
    consultaLog: { create: vi.fn().mockResolvedValue({ id: "log-1" }) },
  };
}

type ClienteFalso = ReturnType<typeof clienteBase>;

// Configura un cliente falso con datos suficientes para que la pregunta
// responda con su camino "hay datos". OTIF_PROVEEDOR_RETRASOS es la
// excepcion deliberada: HOY siempre responde SIN_DATOS_SUFICIENTES (ver
// la nota de cabecera de engine/queries/otifProveedorRetrasos.ts --
// ObservacionKpi no tiene columna de proveedor) -- ninguna configuracion
// de cliente cambia eso, asi que no hay rama para ese caso aca.
function configurarConDatos(cliente: ClienteFalso, catalogoId: CatalogoConsultaId): void {
  switch (catalogoId) {
    case "OTIF_CAIDA": {
      cliente.definicionKpi.findFirst.mockResolvedValue({ id: "def-otif" });
      cliente.observacionKpi.findFirst.mockImplementation((args: { where: { periodoInicio?: Date } }) =>
        Promise.resolve(
          args.where.periodoInicio !== undefined
            ? { valor: 0.9, numerador: 90, denominador: 100, periodoInicio: PERIODO.inicio, periodoFin: PERIODO.fin, ruleVersion: "otif-v1" }
            : { valor: 0.85, numerador: 85, denominador: 100, periodoInicio: new Date("2026-08-01"), periodoFin: new Date("2026-08-31"), ruleVersion: "otif-v1" },
        ),
      );
      break;
    }
    case "OTIF_PROVEEDOR_RETRASOS":
      break;
    case "DEPENDENCIA_CRITICA": {
      cliente.conexionCadena.findMany.mockResolvedValue([
        {
          id: "cx-1",
          impactoFalla: "ALTO",
          tieneAlternativa: false,
          alternativaProbada: null,
          origenNodo: { nombre: "Compras" },
          destinoNodo: { nombre: "Producción" },
        },
      ]);
      break;
    }
    case "FALTANTES_FILL_RATE": {
      cliente.definicionKpi.findFirst.mockResolvedValue({ id: "def-fr" });
      cliente.observacionKpi.findFirst.mockResolvedValue({ valor: 0.95, ruleVersion: "fillrate-v1" });
      break;
    }
    case "ACCION_PRIORITARIA": {
      cliente.hallazgoCadena.findMany.mockResolvedValue([
        { id: "h-1", dimension: "NODO_CRITICO", resultado: "DIFERENCIA", createdAt: new Date("2026-09-15") },
      ]);
      break;
    }
    case "CAMBIOS_ULTIMO_PULSO": {
      cliente.hallazgoCadena.findMany.mockImplementation((args: { where: { createdAt?: { lt?: Date; gte?: Date } } }) =>
        Promise.resolve(
          args.where.createdAt?.lt
            ? [{ id: "h-antes", dimension: "NODO_CRITICO", resultado: "ACUERDO", createdAt: new Date("2026-08-01") }]
            : [{ id: "h-desde", dimension: "NODO_CRITICO", resultado: "DIFERENCIA", createdAt: new Date("2026-09-10") }],
        ),
      );
      break;
    }
  }
}

/** Angosta un ResultadoEjecutarConsulta a RespuestaConsulta -- descarta
 * los 6 arms de error exclusivos del dispatcher (CATALOGO_ID_INVALIDO,
 * CADENA_INEXISTENTE, etc.), que nunca llevan `catalogoId`. */
function comoRespuestaConsulta(resultado: ResultadoEjecutarConsulta): RespuestaConsulta {
  if (!("catalogoId" in resultado)) {
    throw new Error(`se esperaba una RespuestaConsulta, se obtuvo: ${JSON.stringify(resultado)}`);
  }
  return resultado;
}

beforeEach(() => {
  tenantClientMock.mockReset();
  vi.restoreAllMocks();
});

describe("construirConsultaPermitida -- puro, sin Prisma", () => {
  it("CATALOGO_ID_INVALIDO para un id que no es uno de los 6 literales (I5-08)", () => {
    expect(construirConsultaPermitida({ catalogoId: "SELECT * FROM x", cadenaId: CADENA_ID })).toEqual({
      ok: false,
      error: "CATALOGO_ID_INVALIDO",
    });
  });

  it("DEPENDENCIA_CRITICA (requierePeriodo=false) ignora periodoInicio/periodoFin y devuelve periodo: null", () => {
    const resultado = construirConsultaPermitida({
      catalogoId: "DEPENDENCIA_CRITICA",
      cadenaId: CADENA_ID,
      periodoInicio: "esto-se-ignora",
      periodoFin: "esto-tambien",
    });
    expect(resultado).toEqual({ ok: true, entrada: { catalogoId: "DEPENDENCIA_CRITICA", cadenaId: CADENA_ID, periodo: null } });
  });

  it("OTIF_CAIDA (requierePeriodo=true) sin periodoInicio/periodoFin -> PERIODO_REQUERIDO", () => {
    expect(construirConsultaPermitida({ catalogoId: "OTIF_CAIDA", cadenaId: CADENA_ID })).toEqual({
      ok: false,
      error: "PERIODO_REQUERIDO",
    });
  });

  it("fechas no parseables -> PERIODO_INVALIDO", () => {
    const resultado = construirConsultaPermitida({
      catalogoId: "OTIF_CAIDA",
      cadenaId: CADENA_ID,
      periodoInicio: "no-es-una-fecha",
      periodoFin: "2026-09-30",
    });
    expect(resultado).toEqual({ ok: false, error: "PERIODO_INVALIDO" });
  });

  it("inicio posterior a fin -> PERIODO_INVALIDO (via validarPeriodoConsulta)", () => {
    const resultado = construirConsultaPermitida({
      catalogoId: "OTIF_CAIDA",
      cadenaId: CADENA_ID,
      periodoInicio: "2026-09-30",
      periodoFin: "2026-09-01",
    });
    expect(resultado).toEqual({ ok: false, error: "PERIODO_INVALIDO" });
  });

  it("periodo validado -> ok:true con Date reales", () => {
    const resultado = construirConsultaPermitida({
      catalogoId: "OTIF_CAIDA",
      cadenaId: CADENA_ID,
      periodoInicio: "2026-09-01",
      periodoFin: "2026-09-30",
    });
    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error("inalcanzable");
    expect(resultado.entrada.periodo).toEqual({ inicio: new Date("2026-09-01"), fin: new Date("2026-09-30") });
  });
});

describe("ejecutarConsultaPermitida -- dispatcher (I5-09..I5-13)", () => {
  it("CATALOGO_ID_INVALIDO si, por defensa en profundidad, llega un id fuera del catalogo (nunca pasaria la ruta real)", async () => {
    const cliente = clienteBase();
    tenantClientMock.mockReturnValue(cliente);
    const resultado = await ejecutarConsultaPermitida(
      { catalogoId: "NO_EXISTE" as unknown as CatalogoConsultaId, cadenaId: CADENA_ID, periodo: null },
      CONTEXTO,
    );
    expect(resultado).toEqual({ ok: false, error: "CATALOGO_ID_INVALIDO" });
    expect(cliente.cadena.findUnique).not.toHaveBeenCalled();
  });

  it("PERMISO_DENEGADO si el rol de la sesion no esta en metadatos.permisos de la pregunta (I5-10)", async () => {
    // vi.spyOn sobre el namespace del modulo (en vez de vi.mock a nivel de
    // archivo, que aca solo haria falta para ESTA prueba): el resto de las
    // pruebas de este archivo usan el catalogo REAL sin ninguna
    // intervencion. Se restaura automaticamente en el beforeEach de arriba.
    const metadatosReales = catalogoModule.obtenerMetadatosCatalogo("DEPENDENCIA_CRITICA");
    if (!metadatosReales) throw new Error("fixture invalido: DEPENDENCIA_CRITICA deberia existir en el catalogo real");
    vi.spyOn(catalogoModule, "obtenerMetadatosCatalogo").mockReturnValueOnce({ ...metadatosReales, permisos: ["ADMINISTRADOR"] });

    const cliente = clienteBase();
    tenantClientMock.mockReturnValue(cliente);
    const resultado = await ejecutarConsultaPermitida(entradaPara("DEPENDENCIA_CRITICA"), { ...CONTEXTO, rol: "RESPONSABLE" });

    expect(resultado).toEqual({ ok: false, error: "PERMISO_DENEGADO" });
    // el control de permisos corre ANTES de resolver la cadena -- nunca
    // llega a tocar tenantClient si el rol ya esta vetado.
    expect(cliente.cadena.findUnique).not.toHaveBeenCalled();
  });

  it("CADENA_INEXISTENTE si tenantClient().cadena.findUnique no encuentra la cadena (incluye cadena de otro tenant, I5-10/I5-28)", async () => {
    const cliente = clienteBase();
    cliente.cadena.findUnique.mockResolvedValue(null);
    tenantClientMock.mockReturnValue(cliente);
    const resultado = await ejecutarConsultaPermitida(entradaPara("DEPENDENCIA_CRITICA"), CONTEXTO);
    expect(resultado).toEqual({ ok: false, error: "CADENA_INEXISTENTE" });
  });

  it.each(CATALOGO_CONSULTA_IDS)("%s -- dispatcha al ejecutor correcto (resultado.catalogoId coincide con el pedido, I5-11)", async (catalogoId) => {
    const cliente = clienteBase();
    configurarConDatos(cliente, catalogoId);
    tenantClientMock.mockReturnValue(cliente);
    const resultado = comoRespuestaConsulta(await ejecutarConsultaPermitida(entradaPara(catalogoId), CONTEXTO));
    expect(resultado.catalogoId).toBe(catalogoId);
  });

  it.each(CATALOGO_CONSULTA_IDS)("%s -- registra auditoria (I5-13) con el shape minimizado, nunca hecho/interpretacion/accion", async (catalogoId) => {
    const cliente = clienteBase();
    configurarConDatos(cliente, catalogoId);
    tenantClientMock.mockReturnValue(cliente);
    await ejecutarConsultaPermitida(entradaPara(catalogoId), CONTEXTO);

    expect(cliente.consultaLog.create).toHaveBeenCalledTimes(1);
    const llamada = cliente.consultaLog.create.mock.calls[0]?.[0] as { data: Record<string, unknown> } | undefined;
    if (!llamada) throw new Error("consultaLog.create deberia haber sido llamado con { data }");
    const { data } = llamada;
    expect(Object.keys(data).sort()).toEqual(
      ["cadenaId", "catalogoId", "denominador", "empresaId", "numerador", "periodoFin", "periodoInicio", "resultadoOk", "ruleVersion", "usuarioId"].sort(),
    );
    expect(data.empresaId).toBe(CONTEXTO.empresaId);
    expect(data.usuarioId).toBe(CONTEXTO.usuarioId);
    expect(data.cadenaId).toBe(CADENA_ID);
    expect(data.catalogoId).toBe(catalogoId);
  });
});
