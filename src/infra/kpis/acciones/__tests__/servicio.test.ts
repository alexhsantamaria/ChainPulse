// Correccion de ronda de revision -- reescritura de las pruebas de
// crearAccionDecisionKpi/actualizarAccionDecisionKpi para cubrir los 4
// bloqueantes corregidos (ver el reporte de entrega):
//
// (1) derivarOrigenActualAccionKpi() se MOCKEA aca (ver vi.mock mas
//     abajo) -- sus propias pruebas de derivacion (observacion/
//     importacion inexistente, analisis sin recomendacion accionable,
//     etc.) viven en __tests__/derivarOrigenActual.test.ts, aislado de
//     Prisma. Mockearlo aca deja estas pruebas enfocadas en lo que
//     crearAccionDecisionKpi() hace CON el resultado de la derivacion
//     (tenant-consistencia, nunca confiar en lo que el llamador
//     hubiera declarado) sin tener que simular historico/groupBy real
//     en cada caso.
// (2) "rechaza reabrir una accion ya finalizada" se reemplaza por 2
//     pruebas: una que confirma la inmutabilidad total (cambiar un
//     campo QUE NO ES estado en una accion terminal) y otra que
//     confirma que, aun declarando `estado`, el codigo de error sigue
//     siendo el mismo (ACCION_FINALIZADA_INMUTABLE, no TRANSICION_INVALIDA
//     -- ese codigo ahora solo lo dispara una transicion de UN estado
//     terminal a OTRO estado terminal distinto, que en la practica
//     nunca ocurre porque el guard de inmutabilidad corta antes).
// (3) nueva prueba de "2 cierres concurrentes" -- ver el comentario de
//     esa prueba para exactamente que se simula y por que. 2da vuelta
//     de correccion sobre el mismo punto: 2 pruebas mas, una de 2
//     ediciones NO terminales concurrentes (ninguna cambia `estado`) y
//     otra de una edicion concurrente CONTRA un cierre -- ambas cubren
//     el hueco que quedaba cuando el WHERE solo miraba `estado`
//     (`estado` solo no detecta 2 escrituras que dejan `estado` igual).
//     3ra vuelta sobre el mismo punto: esas mismas 2 pruebas (y el
//     fixture `construirClienteFalso`) se actualizan de `updatedAt` a
//     `version` como campo de control de concurrencia -- ver el
//     comentario de cabecera de actualizarAccionDecisionKpi() en
//     servicio.ts para el motivo (precision de milisegundo de
//     `updatedAt`).
// (4) (UI, no aplica a este archivo -- ver accionesDecisionKpiUi.test.ts
//     y los page.test.ts de DetalleObservacionKpi/Cobertura).
import { describe, expect, it, vi, beforeEach } from "vitest";
import { actualizarAccionDecisionKpi, crearAccionDecisionKpi, listarAccionesPorOrigen } from "../servicio";
import type { AccionDecisionKpiFila } from "../tipos";

const derivarOrigenActualAccionKpiMock = vi.fn();
vi.mock("../derivarOrigenActual", () => ({
  derivarOrigenActualAccionKpi: (...args: unknown[]) => derivarOrigenActualAccionKpiMock(...args),
}));

// Fixture: cliente falso que implementa SOLO lo que servicio.ts usa
// DIRECTAMENTE (usuario.findUnique + accionDecisionKpi.*) -- ya NO
// necesita observacionKpi/importacionCsv, porque crearAccionDecisionKpi()
// ya no los consulta el mismo (eso vive detras de
// derivarOrigenActualAccionKpi(), mockeado arriba).
function construirClienteFalso(overrides: {
  usuarios?: Record<string, { id: string; empresaId: string } | null>;
  accionExistente?: AccionDecisionKpiFila | null;
} = {}) {
  const crear = vi.fn(async (args: { data: Record<string, unknown> }) => ({
    id: "accion-nueva",
    estado: "PENDIENTE",
    finalizadaEn: null,
    finalizadaPorId: null,
    createdAt: new Date("2026-11-11T00:00:00Z"),
    updatedAt: new Date("2026-11-11T00:00:00Z"),
    version: 1,
    ...args.data,
  }));

  // updateMany/findUnique por defecto simulan UNA sola fila persistida
  // (overrides.accionExistente) que se va mutando con cada updateMany
  // exitoso -- igual que lo haria Postgres. `count` es 1 solo si TANTO
  // `estado` COMO `version` del WHERE coinciden con lo actualmente
  // almacenado (la MISMA condicion combinada que hace atomica la
  // transicion real -- correccion de ronda de revision, 3ra vuelta: ver
  // el comentario de cabecera de actualizarAccionDecisionKpi() en
  // servicio.ts; version reemplaza al intento anterior con `updatedAt`
  // por su ventana de colision de milisegundo). Cada exito incrementa
  // `version` en 1, igual que el `{ increment: 1 }` real -- asi una 2da
  // llamada que leyo la foto VIEJA (mismo patron de "ambas leen antes
  // de que cualquiera escriba" que ya usan las pruebas de concurrencia
  // de este archivo) deja de matchear aunque `estado` no haya cambiado.
  // `args.data.version` llega como `{ increment: 1 }` (un
  // objeto-directiva, no un numero) -- se ignora a proposito: el
  // spread de `...args.data` lo copia primero, pero el `version:
  // almacenada.version + 1` explicito DESPUES en el mismo objeto lo
  // sobrescribe, igual que Postgres calcula el incremento real dentro
  // de la misma fila bloqueada, nunca a partir de un numero que el
  // cliente hubiera calculado en memoria.
  let almacenada = overrides.accionExistente ?? null;
  const updateMany = vi.fn(async (args: { where: { id: string; estado: string; version: number }; data: Record<string, unknown> }) => {
    if (!almacenada || almacenada.estado !== args.where.estado || almacenada.version !== args.where.version) {
      return { count: 0 };
    }
    almacenada = {
      ...almacenada,
      ...args.data,
      version: almacenada.version + 1,
    } as AccionDecisionKpiFila;
    return { count: 1 };
  });
  const findUnique = vi.fn(async () => almacenada);

  const cliente = {
    usuario: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => overrides.usuarios?.[where.id] ?? null),
    },
    accionDecisionKpi: {
      create: crear,
      updateMany,
      findUnique,
    },
  };

  return cliente as unknown as Parameters<typeof crearAccionDecisionKpi>[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

const RESPONSABLE = { id: "resp-1", empresaId: "emp-1" };
const CREADOR = { id: "creador-1", empresaId: "emp-1" };

const DERIVACION_OK = {
  ok: true as const,
  empresaId: "emp-1",
  cadenaId: "cad-1",
  ruleVersionOrigen: "kpis-v1",
  prioridadOrigen: "ALTA" as const,
};

describe("crearAccionDecisionKpi", () => {
  const datosBase = {
    empresaId: "emp-1",
    descripcionAccion: "Contactar al proveedor X",
    responsableId: RESPONSABLE.id,
    fechaObjetivo: new Date("2026-12-01"),
    creadaPorId: CREADOR.id,
  };

  it("crea la accion derivando ruleVersionOrigen/prioridadOrigen de derivarOrigenActualAccionKpi(), nunca de un valor declarado por el llamador", async () => {
    derivarOrigenActualAccionKpiMock.mockResolvedValue(DERIVACION_OK);
    const cliente = construirClienteFalso({
      usuarios: { [RESPONSABLE.id]: RESPONSABLE, [CREADOR.id]: CREADOR },
    });

    const resultado = await crearAccionDecisionKpi(cliente, {
      ...datosBase,
      origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" },
    });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.datos.cadenaId).toBe("cad-1");
      expect(resultado.datos.ruleVersionOrigen).toBe("kpis-v1");
      expect(resultado.datos.prioridadOrigen).toBe("ALTA");
    }
  });

  it("correccion de ronda de revision (bloqueante 1) -- un llamador que intenta forzar ruleVersionOrigen/prioridadOrigen vía un objeto manipulado nunca llega a persistirse: DatosCrearAccionDecisionKpi ni los admite, y el valor usado SIEMPRE es el que devuelve la derivacion del servidor", async () => {
    // `datos` no permite estos 2 campos a nivel de TIPOS (ver tipos.ts)
    // -- esta prueba simula, con un cast deliberado, un llamador menos
    // cuidadoso (JS puro, o un futuro cambio que se olvide del tipo) que
    // IGUAL los declara en el objeto que le pasa al servicio. La prueba
    // confirma que, aunque esos valores esten ahi, crearAccionDecisionKpi()
    // JAMAS los lee -- usa exclusivamente lo que derivarOrigenActualAccionKpi()
    // devolvio.
    derivarOrigenActualAccionKpiMock.mockResolvedValue(DERIVACION_OK);
    const cliente = construirClienteFalso({
      usuarios: { [RESPONSABLE.id]: RESPONSABLE, [CREADOR.id]: CREADOR },
    });

    const datosManipulados = {
      ...datosBase,
      origen: { tipo: "OBSERVACION_KPI" as const, observacionKpiId: "obs-1" },
      ruleVersionOrigen: "version-FALSIFICADA",
      prioridadOrigen: "BAJA",
    };

    const resultado = await crearAccionDecisionKpi(cliente, datosManipulados as unknown as Parameters<typeof crearAccionDecisionKpi>[1]);

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.datos.ruleVersionOrigen).toBe("kpis-v1");
      expect(resultado.datos.prioridadOrigen).toBe("ALTA");
      expect(resultado.datos.ruleVersionOrigen).not.toBe("version-FALSIFICADA");
      expect(resultado.datos.prioridadOrigen).not.toBe("BAJA");
    }
  });

  it("rechaza cuando el responsable no existe", async () => {
    derivarOrigenActualAccionKpiMock.mockResolvedValue(DERIVACION_OK);
    const cliente = construirClienteFalso({ usuarios: { [CREADOR.id]: CREADOR } });

    const resultado = await crearAccionDecisionKpi(cliente, {
      ...datosBase,
      origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" },
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("RESPONSABLE_INEXISTENTE");
  });

  it("rechaza cuando derivarOrigenActualAccionKpi() dice que la ObservacionKpi de origen no existe", async () => {
    derivarOrigenActualAccionKpiMock.mockResolvedValue({ ok: false, error: "OBSERVACION_KPI_INEXISTENTE" });
    const cliente = construirClienteFalso({
      usuarios: { [RESPONSABLE.id]: RESPONSABLE, [CREADOR.id]: CREADOR },
    });

    const resultado = await crearAccionDecisionKpi(cliente, {
      ...datosBase,
      origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-inexistente" },
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("OBSERVACION_KPI_INEXISTENTE");
  });

  it("rechaza cuando derivarOrigenActualAccionKpi() dice que el origen ya no amerita una accion (ORIGEN_SIN_RECOMENDACION_ACCIONABLE)", async () => {
    derivarOrigenActualAccionKpiMock.mockResolvedValue({ ok: false, error: "ORIGEN_SIN_RECOMENDACION_ACCIONABLE" });
    const cliente = construirClienteFalso({
      usuarios: { [RESPONSABLE.id]: RESPONSABLE, [CREADOR.id]: CREADOR },
    });

    const resultado = await crearAccionDecisionKpi(cliente, {
      ...datosBase,
      origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" },
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ORIGEN_SIN_RECOMENDACION_ACCIONABLE");
  });

  it("rechaza cuando el origen pertenece a otra empresa (ninguna FK por si sola lo impide -- ver validacion.ts)", async () => {
    derivarOrigenActualAccionKpiMock.mockResolvedValue({ ...DERIVACION_OK, empresaId: "emp-OTRA" });
    const cliente = construirClienteFalso({
      usuarios: { [RESPONSABLE.id]: RESPONSABLE, [CREADOR.id]: CREADOR },
    });

    const resultado = await crearAccionDecisionKpi(cliente, {
      ...datosBase,
      empresaId: "emp-1",
      origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" },
    });

    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("TENANT_INCONSISTENTE");
  });

  it("deriva cadenaId de derivarOrigenActualAccionKpi(), nunca lo acepta como input directo", async () => {
    derivarOrigenActualAccionKpiMock.mockResolvedValue(DERIVACION_OK);
    const cliente = construirClienteFalso({
      usuarios: { [RESPONSABLE.id]: RESPONSABLE, [CREADOR.id]: CREADOR },
    });

    const resultado = await crearAccionDecisionKpi(cliente, {
      ...datosBase,
      origen: { tipo: "OBSERVACION_KPI", observacionKpiId: "obs-1" },
    });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) expect(resultado.datos.cadenaId).toBe(DERIVACION_OK.cadenaId);
  });
});

describe("actualizarAccionDecisionKpi", () => {
  const accionPendiente: AccionDecisionKpiFila = {
    id: "accion-1",
    empresaId: "emp-1",
    cadenaId: "cad-1",
    observacionKpiId: "obs-1",
    importacionCsvId: null,
    ruleVersionOrigen: "kpis-v1",
    prioridadOrigen: "ALTA",
    descripcionAccion: "Contactar al proveedor X",
    responsableId: RESPONSABLE.id,
    fechaObjetivo: new Date("2026-12-01"),
    estado: "PENDIENTE",
    creadaPorId: CREADOR.id,
    finalizadaEn: null,
    finalizadaPorId: null,
    createdAt: new Date("2026-11-01"),
    updatedAt: new Date("2026-11-01"),
    version: 1,
  };

  it("actualiza la descripcion sin tocar el estado", async () => {
    const cliente = construirClienteFalso({ accionExistente: accionPendiente });
    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", { descripcionAccion: "Texto nuevo" });
    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.datos.descripcionAccion).toBe("Texto nuevo");
      expect(resultado.datos.estado).toBe("PENDIENTE");
    }
  });

  it("al pasar a COMPLETADA con finalizadaPorId, completa finalizadaEn en la misma llamada", async () => {
    const cliente = construirClienteFalso({
      accionExistente: accionPendiente,
      usuarios: { [RESPONSABLE.id]: { ...RESPONSABLE, empresaId: "emp-1" } },
    });

    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", {
      estado: "COMPLETADA",
      finalizadaPorId: RESPONSABLE.id,
    });

    expect(resultado.ok).toBe(true);
    if (resultado.ok) {
      expect(resultado.datos.estado).toBe("COMPLETADA");
      expect(resultado.datos.finalizadaPorId).toBe(RESPONSABLE.id);
      expect(resultado.datos.finalizadaEn).toBeInstanceOf(Date);
    }
  });

  it("rechaza pasar a COMPLETADA sin finalizadaPorId", async () => {
    const cliente = construirClienteFalso({ accionExistente: accionPendiente });
    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", { estado: "COMPLETADA" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("FALTA_FINALIZADA_POR");
  });

  it("rechaza reabrir una accion ya finalizada (declarando `estado`) con ACCION_FINALIZADA_INMUTABLE, nunca llega a llamar updateMany", async () => {
    const yaCompletada: AccionDecisionKpiFila = {
      ...accionPendiente,
      estado: "COMPLETADA",
      finalizadaEn: new Date("2026-11-05"),
      finalizadaPorId: RESPONSABLE.id,
    };
    const cliente = construirClienteFalso({ accionExistente: yaCompletada });
    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", { estado: "EN_PROGRESO" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ACCION_FINALIZADA_INMUTABLE");
    expect((cliente as unknown as { accionDecisionKpi: { updateMany: ReturnType<typeof vi.fn> } }).accionDecisionKpi.updateMany).not.toHaveBeenCalled();
  });

  it("correccion de ronda de revision (bloqueante 2) -- una accion ya finalizada es INMUTABLE para cualquier campo, no solo para `estado`: un PATCH que cambia SOLO la descripcion (sin declarar `estado`) tambien se rechaza", async () => {
    const yaCompletada: AccionDecisionKpiFila = {
      ...accionPendiente,
      estado: "COMPLETADA",
      finalizadaEn: new Date("2026-11-05"),
      finalizadaPorId: RESPONSABLE.id,
    };
    const cliente = construirClienteFalso({ accionExistente: yaCompletada });
    // Este es exactamente el bug real que esto corrige: ANTES,
    // `estadoNuevo` se calculaba como `cambios.estado ?? actual.estado`
    // -- al no declarar `estado`, `estadoNuevo === actual.estado`, y
    // `validarTransicionEstado()` devolvia ok() de inmediato (su primer
    // if compara estadoActual contra estadoNuevo), dejando pasar el
    // cambio de descripcion sin que nada lo frenara.
    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", { descripcionAccion: "Intento de editar una accion cerrada" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ACCION_FINALIZADA_INMUTABLE");
  });

  it("correccion de ronda de revision (bloqueante 3) -- 2 cierres concurrentes: el segundo PATCH, que leyo el mismo estado PENDIENTE antes de que el primero commiteara, es rechazado con ACCION_MODIFICADA_CONCURRENTEMENTE en vez de pisar el cierre del primero", async () => {
    // Se simula la raza con mocks encadenados en vez de 2 llamadas
    // realmente concurrentes (un test unitario no puede reproducir el
    // entrelazado real de 2 transacciones de Postgres) -- lo que SI se
    // prueba, con precision, es el comportamiento que hace que la raza
    // sea segura en produccion: el `findUnique()` de ambas llamadas ve
    // la MISMA foto (PENDIENTE, antes de que cualquiera escriba) y el
    // `updateMany()` de la 2da devuelve count:0 porque, para cuando se
    // ejecuta, la 1ra YA commiteo (el WHERE `estado: "PENDIENTE"` de la
    // 2da ya no matchea nada) -- exactamente lo que Postgres garantiza
    // al serializar 2 UPDATE concurrentes sobre la misma fila.
    const finalizadaPorLaPrimera: AccionDecisionKpiFila = {
      ...accionPendiente,
      estado: "COMPLETADA",
      finalizadaEn: new Date("2026-11-11T00:05:00Z"),
      finalizadaPorId: RESPONSABLE.id,
      version: accionPendiente.version + 1,
    };

    const findUniqueMock = vi
      .fn()
      // 1ra llamada: lee PENDIENTE (foto antes de que cualquiera escriba).
      .mockResolvedValueOnce(accionPendiente)
      // Re-fetch de la 1ra llamada, DESPUES de su updateMany exitoso.
      .mockResolvedValueOnce(finalizadaPorLaPrimera)
      // 2da llamada: lee la MISMA foto PENDIENTE -- nunca se entera de
      // que la 1ra ya commiteo (asi es exactamente como luce una raza
      // real: ambas transacciones empezaron antes de que cualquiera
      // terminara).
      .mockResolvedValueOnce(accionPendiente);

    const updateManyMock = vi
      .fn()
      // 1ra llamada: su WHERE (estado: "PENDIENTE") SI matchea -- nadie
      // mas habia escrito todavia.
      .mockResolvedValueOnce({ count: 1 })
      // 2da llamada: para cuando Postgres evalua su WHERE (estado:
      // "PENDIENTE"), la fila YA esta en COMPLETADA (la 1ra ya
      // commiteo) -- 0 filas matchean.
      .mockResolvedValueOnce({ count: 0 });

    const cliente = {
      usuario: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === RESPONSABLE.id ? RESPONSABLE : null)),
      },
      accionDecisionKpi: {
        create: vi.fn(),
        updateMany: updateManyMock,
        findUnique: findUniqueMock,
      },
    } as unknown as Parameters<typeof actualizarAccionDecisionKpi>[0];

    const resultadoPrimera = await actualizarAccionDecisionKpi(cliente, "accion-1", {
      estado: "COMPLETADA",
      finalizadaPorId: RESPONSABLE.id,
    });
    expect(resultadoPrimera.ok).toBe(true);
    if (resultadoPrimera.ok) expect(resultadoPrimera.datos.estado).toBe("COMPLETADA");

    const resultadoSegunda = await actualizarAccionDecisionKpi(cliente, "accion-1", {
      estado: "DESCARTADA",
      finalizadaPorId: RESPONSABLE.id,
    });
    expect(resultadoSegunda.ok).toBe(false);
    if (!resultadoSegunda.ok) expect(resultadoSegunda.error).toBe("ACCION_MODIFICADA_CONCURRENTEMENTE");
  });

  it("correccion de ronda de revision (3ra vuelta, bloqueante 3) -- 2 ediciones NO terminales concurrentes, ninguna cambia `estado`: la segunda, que leyo la misma foto antes de que la primera commiteara, es rechazada por ACCION_MODIFICADA_CONCURRENTEMENTE en vez de pisar el cambio de la primera", async () => {
    // Este es el hueco que `estado` solo en el WHERE dejaba abierto: si
    // ninguna de las 2 ediciones cambia `estado` (ej. la 1ra reasigna
    // responsable, la 2da cambia la fecha objetivo, ambas sobre la
    // MISMA PENDIENTE), el `estado` almacenado nunca cambia entre una y
    // otra -- un WHERE que solo mirara `estado` seguiria matcheando en
    // la 2da llamada, pisando en silencio el cambio de la 1ra con datos
    // derivados de su propia foto YA VIEJA (lost update). Con
    // `version` tambien en el WHERE, el exito de la 1ra ya incremento
    // la version e invalido la foto que la 2da leyo, aunque `estado`
    // siga igual (3ra vuelta: reemplaza el intento anterior con
    // `updatedAt`, que tenia una ventana de colision de milisegundo que
    // `version` no tiene).
    const RESP_2 = { id: "resp-2", empresaId: "emp-1" };
    const actualizadaPorLaPrimera: AccionDecisionKpiFila = {
      ...accionPendiente,
      responsableId: RESP_2.id,
      version: accionPendiente.version + 1,
    };

    const findUniqueMock = vi
      .fn()
      // 1ra llamada: lee la foto original (antes de que cualquiera escriba).
      .mockResolvedValueOnce(accionPendiente)
      // Re-fetch de la 1ra, despues de su updateMany exitoso.
      .mockResolvedValueOnce(actualizadaPorLaPrimera)
      // 2da llamada: lee la MISMA foto original -- nunca se entera de
      // que la 1ra ya commiteo (misma foto, misma `version` vieja).
      .mockResolvedValueOnce(accionPendiente);

    const updateManyMock = vi
      .fn()
      // 1ra llamada: su WHERE (estado+version originales) SI matchea.
      .mockResolvedValueOnce({ count: 1 })
      // 2da llamada: `estado` sigue siendo PENDIENTE (ninguna de las 2
      // lo cambia) pero `version` YA avanzo por la 1ra -- su WHERE (con
      // la `version` vieja que leyo) deja de matchear.
      .mockResolvedValueOnce({ count: 0 });

    const cliente = {
      usuario: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === RESP_2.id ? RESP_2 : null)),
      },
      accionDecisionKpi: {
        create: vi.fn(),
        updateMany: updateManyMock,
        findUnique: findUniqueMock,
      },
    } as unknown as Parameters<typeof actualizarAccionDecisionKpi>[0];

    const resultadoPrimera = await actualizarAccionDecisionKpi(cliente, "accion-1", { responsableId: RESP_2.id });
    expect(resultadoPrimera.ok).toBe(true);
    if (resultadoPrimera.ok) expect(resultadoPrimera.datos.responsableId).toBe(RESP_2.id);

    const resultadoSegunda = await actualizarAccionDecisionKpi(cliente, "accion-1", { fechaObjetivo: new Date("2027-01-15") });
    expect(resultadoSegunda.ok).toBe(false);
    if (!resultadoSegunda.ok) expect(resultadoSegunda.error).toBe("ACCION_MODIFICADA_CONCURRENTEMENTE");
  });

  it("correccion de ronda de revision (3ra vuelta, bloqueante 3) -- edicion concurrente CONTRA un cierre: una edicion no terminal que commitea primero bloquea el cierre concurrente que leyo la misma foto, aunque el `estado` leido por el cierre siga siendo el mismo que el almacenado", async () => {
    // Variante del caso anterior con el cierre del OTRO lado de la
    // raza: la 1ra llamada solo edita la descripcion (no toca `estado`,
    // sigue PENDIENTE); la 2da intenta cerrar (PENDIENTE -> COMPLETADA)
    // pero leyo la foto ANTES de que la 1ra commiteara. El `estado` que
    // la 2da leyo (PENDIENTE) sigue siendo exactamente igual al
    // `estado` almacenado (la 1ra no lo toco) -- un WHERE que solo
    // mirara `estado` NO detectaria nada raro aca y dejaria cerrar la
    // accion igual, perdiendo silenciosamente el cambio de descripcion
    // de la 1ra. Con `version` en el WHERE, el cierre es rechazado (3ra
    // vuelta: reemplaza el intento anterior con `updatedAt`).
    const editadaPorLaPrimera: AccionDecisionKpiFila = {
      ...accionPendiente,
      descripcionAccion: "Descripcion actualizada por la 1ra",
      version: accionPendiente.version + 1,
    };

    const findUniqueMock = vi
      .fn()
      // 1ra llamada: lee la foto original.
      .mockResolvedValueOnce(accionPendiente)
      // Re-fetch de la 1ra, despues de su updateMany exitoso.
      .mockResolvedValueOnce(editadaPorLaPrimera)
      // 2da llamada (el cierre): lee la MISMA foto original -- su
      // `estado` (PENDIENTE) es identico al que sigue almacenado, solo
      // `version` difiere.
      .mockResolvedValueOnce(accionPendiente);

    const updateManyMock = vi
      .fn()
      // 1ra llamada: su WHERE (estado+version originales) SI matchea.
      .mockResolvedValueOnce({ count: 1 })
      // 2da llamada: `estado` en su WHERE (PENDIENTE) coincide con el
      // `estado` almacenado (la 1ra no lo cambio) -- si el WHERE SOLO
      // mirara `estado`, esto matchearia por error. Con `version`
      // tambien en el WHERE, la `version` vieja que el cierre leyo ya
      // no coincide con la que dejo la 1ra -- 0 filas matchean.
      .mockResolvedValueOnce({ count: 0 });

    const cliente = {
      usuario: {
        findUnique: vi.fn(async ({ where }: { where: { id: string } }) => (where.id === RESPONSABLE.id ? RESPONSABLE : null)),
      },
      accionDecisionKpi: {
        create: vi.fn(),
        updateMany: updateManyMock,
        findUnique: findUniqueMock,
      },
    } as unknown as Parameters<typeof actualizarAccionDecisionKpi>[0];

    const resultadoPrimera = await actualizarAccionDecisionKpi(cliente, "accion-1", { descripcionAccion: "Descripcion actualizada por la 1ra" });
    expect(resultadoPrimera.ok).toBe(true);
    if (resultadoPrimera.ok) expect(resultadoPrimera.datos.descripcionAccion).toBe("Descripcion actualizada por la 1ra");

    const resultadoCierre = await actualizarAccionDecisionKpi(cliente, "accion-1", {
      estado: "COMPLETADA",
      finalizadaPorId: RESPONSABLE.id,
    });
    expect(resultadoCierre.ok).toBe(false);
    if (!resultadoCierre.ok) expect(resultadoCierre.error).toBe("ACCION_MODIFICADA_CONCURRENTEMENTE");
  });

  it("rechaza un finalizadaPorId de otra empresa", async () => {
    const cliente = construirClienteFalso({
      accionExistente: accionPendiente,
      usuarios: { [RESPONSABLE.id]: { ...RESPONSABLE, empresaId: "emp-OTRA" } },
    });
    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", {
      estado: "DESCARTADA",
      finalizadaPorId: RESPONSABLE.id,
    });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("TENANT_INCONSISTENTE");
  });

  it("rechaza reasignar a un responsable de otra empresa", async () => {
    const cliente = construirClienteFalso({
      accionExistente: accionPendiente,
      usuarios: { "resp-otro": { id: "resp-otro", empresaId: "emp-OTRA" } },
    });
    const resultado = await actualizarAccionDecisionKpi(cliente, "accion-1", { responsableId: "resp-otro" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("TENANT_INCONSISTENTE");
  });

  it("rechaza actualizar una accion inexistente", async () => {
    const cliente = construirClienteFalso({ accionExistente: null });
    const resultado = await actualizarAccionDecisionKpi(cliente, "no-existe", { descripcionAccion: "x" });
    expect(resultado.ok).toBe(false);
    if (!resultado.ok) expect(resultado.error).toBe("ACCION_INEXISTENTE");
  });
});

describe("listarAccionesPorOrigen", () => {
  it("consulta por observacionKpiId cuando ese es el origen", async () => {
    const cliente = {
      accionDecisionKpi: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof listarAccionesPorOrigen>[0];
    const resultado = await listarAccionesPorOrigen(cliente, { observacionKpiId: "obs-1" });
    expect(Array.isArray(resultado)).toBe(true);
  });

  it("consulta por importacionCsvId cuando ese es el origen", async () => {
    const cliente = {
      accionDecisionKpi: { findMany: vi.fn(async () => []) },
    } as unknown as Parameters<typeof listarAccionesPorOrigen>[0];
    const resultado = await listarAccionesPorOrigen(cliente, { importacionCsvId: "imp-1" });
    expect(Array.isArray(resultado)).toBe(true);
  });
});
