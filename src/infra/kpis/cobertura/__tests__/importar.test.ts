// Pruebas -- procesarLoteCobertura()/retirarObservacionesFueraDeAlcance()
// con un `tx` de Prisma falso (mismo patron que
// jobs/__tests__/purgaHuellaOrigenJob.test.ts con un PgBoss falso) -- no
// depende de una conexion real a Postgres. tenantTransaction() en si
// (que si requiere el singleton real de prisma/client.ts) no se ejercita
// aca -- estas dos funciones reciben el `tx` como parametro, exactamente
// para poder probarlas sin ese singleton.
import { describe, expect, it, vi } from "vitest";

// importar.ts importa tenantTransaction.ts, que importa el singleton real
// de prisma/client.ts -- eso construye un PrismaClient real al cargar el
// modulo, y falla en este entorno mientras "prisma generate" siga bloqueado
// (ver README.md). Mismo mock que purgaHuellaOrigenJob.test.ts: solo hace
// falta para que el modulo cargue, procesarLoteCobertura() en si nunca llama
// a tenantTransaction()/prisma directamente -- recibe el `tx` ya armado.
vi.mock("../../../prisma/client", () => ({ prisma: {} }));

// El stub degradado de @prisma/client en la Mac (sin red a
// binaries.prisma.sh, ver README.md) no expone Prisma.join en runtime
// -- confirmado con un smoke test manual (node -e), no es un supuesto.
// Mismo criterio que el resto de este archivo: procesarFinalizacionConRetiroAutorizado()
// recibe un `tx` falso cuyo $queryRaw no inspecciona el SQL armado (eso
// es justo lo que la Mac no puede probar sin Postgres real -- ver el
// test de integracion), asi que a esta prueba unitaria le alcanza con
// que Prisma.join no lance, el valor que devuelva es irrelevante aca.
vi.mock("@prisma/client", () => ({ Prisma: { join: (valores: unknown) => valores } }));
import {
  procesarLoteCobertura,
  procesarRetiroFueraDeAlcance,
  procesarFinalizacionConRetiroAutorizado,
  claveNegocio,
  type ContextoImportacionCobertura,
} from "../importar";
import { calcularHashVistaPreviaRetiro } from "../../../../domain/hashVistaPreviaRetiroCobertura";
import type { FilaCoberturaParaImportar } from "../../../../domain/prepararFilasCoberturaParaImportar";
import { calcularContenidoHashCobertura } from "../../../../domain/contenidoHashCobertura";

function contexto(overrides: Partial<ContextoImportacionCobertura> = {}): ContextoImportacionCobertura {
  return {
    empresaId: "empresa-1",
    cadenaId: "cadena-1",
    definicionKpiId: "def-cobertura",
    importId: "import-1",
    fuenteConsumo: "ERP mayo 2026",
    periodoReferenciaConsumoInicio: new Date("2026-05-01T12:00:00.000Z"),
    periodoReferenciaConsumoFin: new Date("2026-05-31T12:00:00.000Z"),
    ruleVersion: "v1",
    zonaHorariaReferencia: "America/Lima",
    ...overrides,
  };
}

function filaParaGuardar(overrides: Partial<FilaCoberturaParaImportar> = {}): FilaCoberturaParaImportar {
  return {
    numeroFila: 1,
    skuOriginal: "a-001",
    ubicacionOriginal: "Lima",
    fila: {
      sku: "A-001",
      ubicacion: "LIMA",
      fecha: new Date("2026-09-24T12:00:00.000Z"),
      inventarioDisponible: 100,
      consumoDiarioEsperado: 10,
      unidadInventario: "unidad",
      unidadConsumoDiario: "unidad",
    },
    estado: "CALCULADA",
    coberturaDias: 10,
    ...overrides,
  };
}

function txFalso(vigentesExistentes: Array<{ id: string; sku: string; ubicacion: string; fechaCorte: Date; contenidoHash: string }> = []) {
  const creadas: Array<Record<string, unknown>> = [];
  const actualizadas: Array<Record<string, unknown>> = [];
  let contadorId = 0;
  return {
    observacionCobertura: {
      findMany: vi.fn().mockResolvedValue(vigentesExistentes),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        creadas.push(data);
        contadorId += 1;
        return { id: data.id ?? `generada-${contadorId}` };
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        actualizadas.push({ id: where.id, ...data });
        return {};
      }),
    },
    __creadas: creadas,
    __actualizadas: actualizadas,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo se usan los metodos de arriba en este archivo.
  } as any;
}

describe("procesarLoteCobertura", () => {
  it("lote vacio no hace ninguna consulta", async () => {
    const tx = txFalso();
    const r = await procesarLoteCobertura(tx, contexto(), []);
    expect(r).toEqual({ insertadas: 0, corregidas: 0, sinCambios: 0, yaProcesadas: 0 });
    expect(tx.observacionCobertura.findMany).not.toHaveBeenCalled();
  });

  it("inserta una fila nueva cuando no existe ninguna vigente previa con esa clave de negocio", async () => {
    const tx = txFalso([]);
    const r = await procesarLoteCobertura(tx, contexto(), [filaParaGuardar()]);
    expect(r).toEqual({ insertadas: 1, corregidas: 0, sinCambios: 0, yaProcesadas: 0 });
    expect(tx.__creadas).toHaveLength(1);
    expect(tx.__creadas[0]?.vigente).toBe(true);
    expect(tx.__actualizadas).toHaveLength(0);
  });

  it("no-op cuando ya existe una fila vigente con el MISMO contenidoHash (reintento identico)", async () => {
    const hashIdentico = calcularContenidoHashCobertura({
      sku: "A-001",
      ubicacion: "LIMA",
      fechaCorte: new Date("2026-09-24T12:00:00.000Z"),
      inventarioDisponible: 100,
      unidadInventario: "unidad",
      consumoDiarioEsperado: 10,
      unidadConsumoDiario: "unidad",
      fuenteConsumo: "ERP mayo 2026",
      periodoReferenciaConsumoInicio: new Date("2026-05-01T12:00:00.000Z"),
      periodoReferenciaConsumoFin: new Date("2026-05-31T12:00:00.000Z"),
      ruleVersion: "v1",
    });
    const tx = txFalso([
      { id: "vieja-1", sku: "A-001", ubicacion: "LIMA", fechaCorte: new Date("2026-09-24T12:00:00.000Z"), contenidoHash: hashIdentico },
    ]);
    const r = await procesarLoteCobertura(tx, contexto(), [filaParaGuardar()]);
    expect(r).toEqual({ insertadas: 0, corregidas: 0, sinCambios: 1, yaProcesadas: 0 });
    expect(tx.__creadas).toHaveLength(0);
    expect(tx.__actualizadas).toHaveLength(0);
  });

  it("correccion real: hash distinto inserta una fila nueva y marca la vieja como no vigente con reemplazadaPorId", async () => {
    const tx = txFalso([
      { id: "vieja-1", sku: "A-001", ubicacion: "LIMA", fechaCorte: new Date("2026-09-24T12:00:00.000Z"), contenidoHash: "hash-distinto" },
    ]);
    const r = await procesarLoteCobertura(tx, contexto(), [filaParaGuardar()]);
    expect(r).toEqual({ insertadas: 1, corregidas: 1, sinCambios: 0, yaProcesadas: 0 });
    expect(tx.__actualizadas).toHaveLength(1);
    const idNuevaFila = tx.__creadas[0]?.id ?? "generada-1"; // el id lo asigna create() (cuid por defecto, ver prisma/schema.prisma) -- nunca lo generamos nosotros.
    expect(tx.__actualizadas[0]).toMatchObject({ id: "vieja-1", vigente: false, reemplazadaPorId: idNuevaFila });
  });

  it("retry-safety: create() choca por P2002 (importId+numeroFila ya procesado) -- se cuenta como yaProcesadas, nunca error", async () => {
    const tx = txFalso([]);
    tx.observacionCobertura.create.mockRejectedValueOnce(Object.assign(new Error("unique violation"), { code: "P2002" }));
    const r = await procesarLoteCobertura(tx, contexto(), [filaParaGuardar()]);
    expect(r).toEqual({ insertadas: 0, corregidas: 0, sinCambios: 0, yaProcesadas: 1 });
  });

  it("un error que no es P2002 se propaga (nunca se traga en silencio)", async () => {
    const tx = txFalso([]);
    tx.observacionCobertura.create.mockRejectedValueOnce(new Error("conexion caida"));
    await expect(procesarLoteCobertura(tx, contexto(), [filaParaGuardar()])).rejects.toThrow("conexion caida");
  });

  it("busca las filas vigentes existentes con una sola consulta para todo el lote (nunca una por fila)", async () => {
    const tx = txFalso([]);
    await procesarLoteCobertura(tx, contexto(), [
      filaParaGuardar({ numeroFila: 1 }),
      filaParaGuardar({ numeroFila: 2, fila: { ...filaParaGuardar().fila, sku: "A-002" } }),
    ]);
    expect(tx.observacionCobertura.findMany).toHaveBeenCalledTimes(1);
  });
});

describe("claveNegocio", () => {
  it("usa solo el dia calendario de fechaCorte (ignora la hora)", () => {
    const a = claveNegocio("A-001", "LIMA", new Date("2026-09-24T00:00:01.000Z"));
    const b = claveNegocio("A-001", "LIMA", new Date("2026-09-24T23:59:00.000Z"));
    expect(a).toBe(b);
  });
});

describe("procesarRetiroFueraDeAlcance", () => {
  const alcance = {
    fechaCorteInicio: new Date("2026-09-01T00:00:00.000Z"),
    fechaCorteFin: new Date("2026-09-30T00:00:00.000Z"),
    ubicaciones: ["LIMA"],
  };

  it("retira (vigente=false, reemplazadaPorId sin tocar) una fila vigente en el alcance que NO vino en el archivo", async () => {
    const tx = txFalso();
    tx.observacionCobertura.findMany.mockResolvedValue([
      { id: "vieja-1", sku: "A-999", ubicacion: "LIMA", fechaCorte: new Date("2026-09-24T12:00:00.000Z") },
    ]);
    const r = await procesarRetiroFueraDeAlcance(
      tx,
      { empresaId: "empresa-1", cadenaId: "cadena-1" },
      alcance,
      new Set<string>(), // el archivo no trajo esta clave
    );
    expect(r).toEqual({ retiradas: 1 });
    expect(tx.__actualizadas).toHaveLength(1);
    expect(tx.__actualizadas[0]).toMatchObject({ id: "vieja-1", vigente: false });
    expect(tx.__actualizadas[0]?.reemplazadaPorId).toBeUndefined(); // "se retira", no "se reemplaza"
  });

  it("NO retira una fila vigente cuyo clave de negocio SI vino en el archivo", async () => {
    const tx = txFalso();
    const clave = claveNegocio("A-999", "LIMA", new Date("2026-09-24T12:00:00.000Z"));
    tx.observacionCobertura.findMany.mockResolvedValue([
      { id: "vieja-1", sku: "A-999", ubicacion: "LIMA", fechaCorte: new Date("2026-09-24T12:00:00.000Z") },
    ]);
    const r = await procesarRetiroFueraDeAlcance(
      tx,
      { empresaId: "empresa-1", cadenaId: "cadena-1" },
      alcance,
      new Set([clave]),
    );
    expect(r).toEqual({ retiradas: 0 });
    expect(tx.__actualizadas).toHaveLength(0);
  });

  it("sin filas vigentes en el alcance, no actualiza nada", async () => {
    const tx = txFalso();
    tx.observacionCobertura.findMany.mockResolvedValue([]);
    const r = await procesarRetiroFueraDeAlcance(tx, { empresaId: "empresa-1", cadenaId: "cadena-1" }, alcance, new Set());
    expect(r).toEqual({ retiradas: 0 });
  });
});

// txFalso() (arriba) modela un `tx` con la API de la ORM de Prisma
// (findMany/create/update) -- procesarFinalizacionConRetiroAutorizado()
// ademas usa $queryRaw (para el FOR UPDATE, que la ORM no expone) y
// tx.importacionCsv.update() (para la finalizacion). Helper aparte para
// no complicar txFalso() con metodos que el resto de este archivo no
// necesita.
function txFalsoParaRetiroAutorizado(
  filasBloqueadas: Array<{ id: string; sku: string; ubicacion: string; fechaCorteIso: string }>,
) {
  const observacionesActualizadas: Array<{ id: string; data: Record<string, unknown> }> = [];
  const importacionesActualizadas: Array<{ where: unknown; data: Record<string, unknown> }> = [];
  return {
    // Tagged template -- vi.fn() recibe (strings, ...valores) igual que
    // una llamada normal, alcanza con devolver siempre las mismas filas
    // "bloqueadas" sin inspeccionar el SQL armado (eso es exactamente lo
    // que NO se puede probar sin Postgres real -- ver el test de
    // integracion 5.3 para el FOR UPDATE en si).
    $queryRaw: vi.fn().mockResolvedValue(filasBloqueadas),
    observacionCobertura: {
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) => {
        observacionesActualizadas.push({ id: where.id, data });
        return {};
      }),
    },
    importacionCsv: {
      update: vi.fn(async ({ where, data }: { where: unknown; data: Record<string, unknown> }) => {
        importacionesActualizadas.push({ where, data });
        return {};
      }),
    },
    __observacionesActualizadas: observacionesActualizadas,
    __importacionesActualizadas: importacionesActualizadas,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- solo se usan los metodos de arriba en este archivo.
  } as any;
}

describe("procesarFinalizacionConRetiroAutorizado", () => {
  const contexto = { empresaId: "empresa-1", cadenaId: "cadena-1", importId: "import-1" };
  const alcance = {
    fechaCorteInicio: new Date("2026-09-01T00:00:00.000Z"),
    fechaCorteFin: new Date("2026-09-30T00:00:00.000Z"),
    ubicaciones: ["LIMA"],
  };
  const datosFinalizacion = { filasDetectadas: 5, filasConError: 0, erroresMuestra: null };

  it("hash recalculado coincide con el autorizado -- retira las candidatas y finaliza (CONFIRMADA+procesadaEn) EN LA MISMA llamada", async () => {
    const filaVieja = { id: "vieja-1", sku: "A-999", ubicacion: "LIMA", fechaCorteIso: "2026-09-24" };
    const hashAutorizado = calcularHashVistaPreviaRetiro(
      [{ id: filaVieja.id, sku: filaVieja.sku, ubicacion: filaVieja.ubicacion, fechaCorte: new Date("2026-09-24T00:00:00.000Z") }],
      alcance,
    );
    const tx = txFalsoParaRetiroAutorizado([filaVieja]);
    const r = await procesarFinalizacionConRetiroAutorizado(tx, contexto, alcance, new Set(), hashAutorizado, datosFinalizacion);
    expect(r).toEqual({ ok: true, retiradas: 1 });
    expect(tx.__observacionesActualizadas).toEqual([{ id: "vieja-1", data: { vigente: false, reemplazadaEn: expect.any(Date) } }]);
    expect(tx.__importacionesActualizadas).toEqual([
      {
        where: { id: "import-1" },
        data: { estado: "CONFIRMADA", procesadaEn: expect.any(Date), filasDetectadas: 5, filasConError: 0, erroresMuestra: null },
      },
    ]);
  });

  it("hash recalculado NO coincide (algo cambio desde la confirmacion) -- no retira nada, no finaliza nada, devuelve HASH_DESACTUALIZADO", async () => {
    const filaVieja = { id: "vieja-1", sku: "A-999", ubicacion: "LIMA", fechaCorteIso: "2026-09-24" };
    const tx = txFalsoParaRetiroAutorizado([filaVieja]);
    const r = await procesarFinalizacionConRetiroAutorizado(
      tx,
      contexto,
      alcance,
      new Set(),
      "hash-de-una-vista-previa-vieja-que-ya-no-coincide",
      datosFinalizacion,
    );
    expect(r).toEqual({ ok: false, motivo: "HASH_DESACTUALIZADO" });
    expect(tx.observacionCobertura.update).not.toHaveBeenCalled();
    expect(tx.importacionCsv.update).not.toHaveBeenCalled();
  });

  it("una fila que YA vino en el archivo (misma clave de negocio) nunca cuenta como candidata, aunque este vigente y en alcance", async () => {
    const fechaCorte = new Date("2026-09-24T00:00:00.000Z");
    const filaVigente = { id: "vieja-1", sku: "A-999", ubicacion: "LIMA", fechaCorteIso: "2026-09-24" };
    const clave = claveNegocio("A-999", "LIMA", fechaCorte);
    const hashSinCandidatas = calcularHashVistaPreviaRetiro([], alcance);
    const tx = txFalsoParaRetiroAutorizado([filaVigente]);
    const r = await procesarFinalizacionConRetiroAutorizado(tx, contexto, alcance, new Set([clave]), hashSinCandidatas, datosFinalizacion);
    expect(r).toEqual({ ok: true, retiradas: 0 });
    expect(tx.observacionCobertura.update).not.toHaveBeenCalled();
    expect(tx.__importacionesActualizadas).toHaveLength(1); // igual finaliza, solo que sin retirar nada
  });
});

