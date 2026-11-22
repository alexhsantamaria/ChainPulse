// Pruebas -- POST /api/consultas/ejecutar. requireSession,
// ejecutarConsultaPermitida y registrarIntento (limite de tasa)
// mockeados (construirConsultaPermitida corre REAL via importActual --
// es pura, sin Prisma): esta prueba es de la RUTA (parseo de payload,
// mapeo de errores a status HTTP, que empresaId/usuarioId/rol SIEMPRE
// salgan de la sesion y nunca del payload, y -- Incremento 5 PR1 -- el
// limite de tasa antes del dispatcher), no del dispatcher en si (eso lo
// cubre infra/queries/__tests__/ejecutarConsultaPermitida.test.ts) ni
// de registrarIntento() en si (eso ya esta documentado como prueba de
// integracion pendiente, ver infra/rateLimit/__tests__/huella.test.ts).
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const requireSessionMock = vi.fn();
vi.mock("@/infra/auth/session", () => ({ requireSession: (...args: unknown[]) => requireSessionMock(...args) }));

// construirConsultaPermitida() (pura) corre REAL via importActual, pero
// ese mismo archivo fuente tambien importa tenantClient() -> prisma/client
// -> new PrismaClient() a nivel de modulo -- y "prisma generate" sigue
// bloqueado en este entorno (ver README). Sin este mock, importActual()
// reventaria igual que cualquier otro test que toque el Prisma Client
// real (mismo motivo que job.test.ts). ejecutarConsultaPermitida() en si
// esta mockeado abajo y nunca llega a usar tenantClient real.
vi.mock("@/infra/prisma/tenantClient", () => ({ tenantClient: vi.fn() }));

// Incremento 5 PR1 -- route.ts ahora tambien importa
// @/infra/prisma/client (el singleton SIN tenant que usa registrarIntento)
// directamente. Mismo motivo que el mock de tenantClient arriba: ese
// modulo construye `new PrismaClient({ adapter })` a nivel de modulo, y
// "prisma generate" sigue bloqueado en este entorno -- se mockea para
// que import("../route") nunca intente construir un cliente real. El
// objeto en si nunca se usa de verdad: registrarIntento (mockeado abajo)
// nunca llega a tocarlo.
vi.mock("@/infra/prisma/client", () => ({ prisma: {} }));

const ejecutarConsultaPermitidaMock = vi.fn();
vi.mock("@/infra/queries/ejecutarConsultaPermitida", async () => {
  const actual = await vi.importActual<typeof import("@/infra/queries/ejecutarConsultaPermitida")>("@/infra/queries/ejecutarConsultaPermitida");
  return {
    ...actual,
    ejecutarConsultaPermitida: (...args: unknown[]) => ejecutarConsultaPermitidaMock(...args),
  };
});

// Incremento 5 PR1 -- registrarIntento() mockeado (ver el comentario de
// huella.test.ts: necesita Postgres real, no se puede ejercitar aca).
// hashHuellaOrigen/codificarHuellaConsultaAutenticada/
// calcularSegundosHastaProximoIntentoPermitido/LIMITE_CONSULTA_EJECUTAR corren REALES
// via importActual -- son puros (ya probados por separado en
// huella.test.ts) y esta prueba quiere verificar el ENSAMBLADO real de
// route.ts con ellos (p.ej. que el Retry-After que llega en la
// respuesta HTTP sea el que esos mismos puros calculan).
const registrarIntentoMock = vi.fn();
vi.mock("@/infra/rateLimit/limiteTasa", async () => {
  const actual = await vi.importActual<typeof import("@/infra/rateLimit/limiteTasa")>("@/infra/rateLimit/limiteTasa");
  return {
    ...actual,
    registrarIntento: (...args: unknown[]) => registrarIntentoMock(...args),
  };
});

// Incremento 5 PR1 -- se mockea para poder verificar, sin tocar stdout,
// que el camino de rate-limit nunca pasa el error crudo ni ningun dato
// de tenant/usuario al logger (ver eventoConsultaRateLimit.ts).
const registrarEventoRateLimitConsultaMock = vi.fn();
vi.mock("@/infra/rateLimit/eventoConsultaRateLimit", () => ({
  registrarEventoRateLimitConsulta: (...args: unknown[]) => registrarEventoRateLimitConsultaMock(...args),
}));

// Incremento 5 PR4 -- se mockea para poder verificar, sin tocar
// stdout, el evento de latencia total (duracionMs/statusHttp/catalogoId,
// nunca cadenaId/empresaId/usuarioId).
const registrarEventoLatenciaConsultaMock = vi.fn();
vi.mock("@/infra/queries/eventoLatenciaConsulta", () => ({
  registrarEventoLatenciaConsulta: (...args: unknown[]) => registrarEventoLatenciaConsultaMock(...args),
}));

const SESION_ADMIN = { usuarioId: "u1", empresaId: "e1", rol: "ADMINISTRADOR", email: "a@b.com", nombre: null, eslabonId: null };
const PAYLOAD_SIN_PERIODO = { catalogoId: "DEPENDENCIA_CRITICA", cadenaId: "cadena-1" };
const PAYLOAD_CON_PERIODO = { catalogoId: "OTIF_CAIDA", cadenaId: "cadena-1", periodoInicio: "2026-09-01", periodoFin: "2026-09-30" };

function construirRequest(body: unknown): Request {
  return new Request("http://localhost/api/consultas/ejecutar", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.HUELLA_ORIGEN_SALT = "salto-pruebas-no-real";
  requireSessionMock.mockResolvedValue({ sesion: SESION_ADMIN });
  // Por defecto, permitido (la mayoria de los tests existentes no son
  // sobre el limite de tasa en si) -- buckets vacio porque ninguna de
  // esas pruebas necesita calcular un Retry-After real.
  registrarIntentoMock.mockResolvedValue({ contador: 1, permitido: true, buckets: [] });
});

afterEach(() => {
  // Red de seguridad -- cualquier test que haya usado
  // vi.useFakeTimers() vuelve a reloj real, sin importar si el test
  // termino en assert exitoso o lanzo antes de su propio cleanup.
  vi.useRealTimers();
});

describe("POST /ejecutar -- autenticacion", () => {
  it("sin sesion valida -- devuelve la respuesta de requireSession tal cual, nunca llama a ejecutarConsultaPermitida", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(401);
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  // Investigacion (Alex, 2026-11-20): reproduce, al nivel del CONTRATO
  // de la ruta, la forma EXACTA del 401 que produce un mismatch de
  // useSecureCookies entre la cookie sintetica minteada y lo que el
  // servidor resuelve para ese deployment -- ver la cadena de causa
  // completa, probada con criptografia REAL (encode()/decode() de
  // next-auth/jwt, sin mocks), en
  // src/infra/queries/rendimiento/__tests__/sesionSinteticaHelpers.test.ts
  // (describe "mintarCookieSesionSintetica(..., useSecureCookies)").
  // Esta prueba no puede minar la cookie y pegarle a esta ruta sin
  // mockear directamente (route.ts y @/auth importan Prisma/Argon2 a
  // nivel de modulo, y "prisma generate" sigue bloqueado en este
  // entorno -- ver comentario de cabecera de este archivo); en cambio,
  // fija el eslabon exacto que YA esta probado en el otro archivo:
  // requireSession() (src/infra/auth/session.ts, SIN_SESION) devuelve
  // SIEMPRE `{ok:false, error:"NO_SESION"}` con status 401 cuando
  // `session?.user` es falsy -- que es precisamente lo que `auth()`
  // devuelve cuando jwt.decode() falla por salt incorrecto (ver
  // @auth/core/lib/actions/session.js: el catch que rodea jwt.decode()
  // deja response.body=null sin relanzar). NO debilita ni omite el 401
  // de la prueba anterior -- la complementa verificando tambien el
  // CUERPO exacto, no solo el status.
  it("CONTRATO 401 por sesion invalida (incluye el caso de salt/cookie incorrecto): el cuerpo es SIEMPRE exactamente {ok:false, error:\"NO_SESION\"} -- nunca un mensaje distinto que filtre la causa (secreto vs. salt vs. sessionVersion)", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(401);
    expect(await respuesta.json()).toEqual({ ok: false, error: "NO_SESION" });
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });
});

describe("POST /ejecutar -- validacion de payload (antes de llamar al dispatcher)", () => {
  it("body no-JSON -> 400 CUERPO_INVALIDO, nunca llama al dispatcher", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest("esto no es json"));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CUERPO_INVALIDO");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("falta catalogoId -> 400 DATOS_INVALIDOS", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("DATOS_INVALIDOS");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("catalogoId fuera del catalogo cerrado -> 400 CATALOGO_ID_INVALIDO (I5-08), nunca llama al dispatcher", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ catalogoId: "SELECT * FROM x", cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("CATALOGO_ID_INVALIDO");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("pregunta que requiere periodo sin periodoInicio/periodoFin -> 400 PERIODO_REQUERIDO, nunca llama al dispatcher", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ catalogoId: "OTIF_CAIDA", cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);
    expect((await respuesta.json()).error).toBe("PERIODO_REQUERIDO");
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });
});

describe("POST /ejecutar -- empresaId/usuarioId/rol SIEMPRE de la sesion, nunca del payload", () => {
  it("un intento de inyectar empresaId/usuarioId/rol en el body es ignorado -- el contexto pasado al dispatcher es el de requireSession", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "CADENA_INEXISTENTE" });
    const { POST } = await import("../route");
    await POST(
      construirRequest({
        ...PAYLOAD_SIN_PERIODO,
        empresaId: "empresa-ajena",
        usuarioId: "usuario-ajeno",
        rol: "ADMINISTRADOR_FALSO",
      }),
    );

    expect(ejecutarConsultaPermitidaMock).toHaveBeenCalledTimes(1);
    const [, contexto] = ejecutarConsultaPermitidaMock.mock.calls[0] as [unknown, { empresaId: string; usuarioId: string; rol: string }];
    expect(contexto).toEqual({ empresaId: SESION_ADMIN.empresaId, usuarioId: SESION_ADMIN.usuarioId, rol: SESION_ADMIN.rol });
  });
});

describe("POST /ejecutar -- mapeo de errores del dispatcher a status HTTP", () => {
  it("CADENA_INEXISTENTE -> 404", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "CADENA_INEXISTENTE" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(404);
  });

  it("PERMISO_DENEGADO -> 403", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "PERMISO_DENEGADO" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(403);
  });

  it("PRESUPUESTO_COMPUTO_EXCEDIDO -> 503, SIN header Retry-After y SIN duracionMs en el body (Incremento 5 PR2 -- a diferencia de LIMITE_TASA_EXCEDIDO, reintentar no promete nada distinto, y el timing nunca viaja al cliente)", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(503);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" });
    expect(cuerpo).not.toHaveProperty("duracionMs");
    expect(respuesta.headers.get("Retry-After")).toBeNull();
  });

  it("SIN_DATOS_SUFICIENTES -> 200 (es una respuesta honesta y esperada, I5-25, nunca una falla de la ruta)", async () => {
    const respuestaSinDatos = {
      ok: false,
      catalogoId: "OTIF_CAIDA",
      error: "SIN_DATOS_SUFICIENTES",
      mensaje: "No puedo responder todavía",
      camposFaltantes: ["periodo actual"],
      comoIngresarlos: "Declara el periodo",
    };
    ejecutarConsultaPermitidaMock.mockResolvedValue(respuestaSinDatos);
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_CON_PERIODO));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual(respuestaSinDatos);
  });

  it("ok:true -> 200 con la respuesta completa (hecho/interpretacion/accion incluidos)", async () => {
    const respuestaOk = {
      ok: true,
      catalogoId: "OTIF_CAIDA",
      respuestaDirecta: "El OTIF se mantuvo.",
      periodo: { inicio: "2026-09-01", fin: "2026-09-30" },
      filtros: {},
      fuente: "ObservacionKpi",
      formula: "numerador/denominador",
      numerador: 90,
      denominador: 100,
      calidad: { faltantes: [], cobertura: 1 },
      hecho: "El OTIF del periodo fue 90%.",
      interpretacion: "Se mantuvo respecto al periodo anterior.",
      accion: "Ninguna accion urgente.",
      comoComprobar: "Revisa ObservacionKpi del periodo.",
      ruleVersion: "consultas-v1",
    };
    ejecutarConsultaPermitidaMock.mockResolvedValue(respuestaOk);
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_CON_PERIODO));
    expect(respuesta.status).toBe(200);
    expect(await respuesta.json()).toEqual(respuestaOk);
  });
});


describe("POST /ejecutar -- limite de tasa (Incremento 5 PR1, antes del dispatcher)", () => {
  it("permitido -- SI llama al dispatcher (el camino feliz no se rompe) y registra el evento PERMITIDA saneado", async () => {
    registrarIntentoMock.mockResolvedValue({ contador: 3, permitido: true, buckets: [] });
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "CADENA_INEXISTENTE" });
    const { POST } = await import("../route");
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(ejecutarConsultaPermitidaMock).toHaveBeenCalledTimes(1);
    expect(registrarEventoRateLimitConsultaMock).toHaveBeenCalledWith(
      "CONSULTA_RATE_LIMIT_PERMITIDA",
      expect.objectContaining({ contador: 3, catalogoId: "DEPENDENCIA_CRITICA" }),
    );
  });

  it("no permitido -- 429 LIMITE_TASA_EXCEDIDO con Retry-After EXACTO para este fixture (header Y body, con reloj fijado via fake timers)", async () => {
    // Fake timers (ronda 2 de revision, Alex 2026-11-18: "usar fake
    // timers/system time; construir buckets relativos al reloj
    // fijado; comprobar un valor EXACTO y mayor que cero") -- el
    // "ahora" de route.ts (new Date() interno, no mockeado) queda
    // fijo en 15:00:00Z, asi que el bucket de 14:45 (truncado a 15
    // min) expira de la ventana de 60 min exactamente a las 15:45Z --
    // faltan 45 min = 2700s, un numero EXACTO y verificable a mano, no
    // solo "mayor que 0". "EXACTO" aca es exacto PARA ESTE FIXTURE --
    // reloj fijado con fake timers y sin ninguna solicitud concurrente
    // durante la prueba (ver el docstring de
    // calcularSegundosHastaProximoIntentoPermitido() en huella.ts: el
    // valor deja de ser exacto si llega una solicitud adicional
    // mientras se espera, algo que este test, por diseno, no simula).
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T15:00:00.000Z"));

    const ventanaInicio = new Date("2026-09-16T14:45:00.000Z");
    registrarIntentoMock.mockResolvedValue({ contador: 31, permitido: false, buckets: [{ ventanaInicio, contador: 31 }] });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(429);
    const cuerpo = await respuesta.json();
    expect(cuerpo).toEqual({ ok: false, error: "LIMITE_TASA_EXCEDIDO", retryAfterSegundos: 2700 });
    // Igualdad EXACTA entre el header Retry-After y el campo del body
    // -- nunca "ambos son numeros", el mismo valor literal en los dos.
    expect(respuesta.headers.get("Retry-After")).toBe("2700");
    expect(Number(respuesta.headers.get("Retry-After"))).toBe(cuerpo.retryAfterSegundos);
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("no permitido -- frontera: el bucket MAS VIEJO expira pero quitarlo solo no alcanza (sigue excedido) -- el Retry-After lo fija el SIGUIENTE bucket mas viejo, con reloj fijado", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-16T14:50:00.000Z"));

    const { LIMITE_CONSULTA_EJECUTAR } = await import("@/infra/rateLimit/limiteTasa");
    // Total 45 (10+15+20), limite 30. Quitar el mas viejo (13:45, 10)
    // deja 35 -- TODAVIA excedido (35 > 30), no alcanza con ese solo.
    // Quitar el segundo mas viejo (14:00, 15) deja 20 <= 30 -- recien
    // ahi queda permitido, asi que el Retry-After depende de CUANDO
    // expira el bucket de las 14:00 (14:00 + 60min = 15:00Z), nunca del
    // de las 13:45 ni del de las 14:45. Desde las 14:50Z faltan 10min = 600s.
    registrarIntentoMock.mockResolvedValue({
      contador: 45,
      permitido: false,
      buckets: [
        { ventanaInicio: new Date("2026-09-16T13:45:00.000Z"), contador: 10 },
        { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 15 },
        { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 20 },
      ],
    });
    expect(LIMITE_CONSULTA_EJECUTAR).toBe(30); // aserta la premisa del calculo a mano de arriba

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(429);
    const cuerpo = await respuesta.json();
    expect(cuerpo.retryAfterSegundos).toBe(600);
    expect(respuesta.headers.get("Retry-After")).toBe("600");
  });

  it(
    "ronda 3 de revision de Alex -- frontera 1 + 30: el bucket MAS VIEJO (1) expira pero quitarlo " +
      "solo deja EXACTAMENTE el limite (30), insuficiente para el PROXIMO intento -- el Retry-After " +
      "correcto lo fija el bucket de 30 (no el de 1), con reloj fijado via fake timers",
    async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-16T14:50:00.000Z"));

      const { LIMITE_CONSULTA_EJECUTAR } = await import("@/infra/rateLimit/limiteTasa");
      expect(LIMITE_CONSULTA_EJECUTAR).toBe(30); // aserta la premisa del calculo a mano de abajo

      // Total 31 (1+30), limite 30. Quitar el mas viejo (14:00, 1) deja
      // 30 == limite -- PERMITIDO por si solo, pero el PROXIMO intento
      // (30+1=31) seguiria excediendolo: antes de la correccion de
      // ronda 3 esto hubiera devuelto el Retry-After del bucket de las
      // 14:00 (ya expirado para las 14:50, dando 0s -- un segundo 429
      // inmediato). Con la correccion, hay que esperar tambien al
      // bucket de 30 (14:45): 14:45 + 60min = 15:45Z, desde las 14:50Z
      // faltan 55 min = 3300s.
      registrarIntentoMock.mockResolvedValue({
        contador: 31,
        permitido: false,
        buckets: [
          { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 1 },
          { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 30 },
        ],
      });

      const { POST } = await import("../route");
      const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

      expect(respuesta.status).toBe(429);
      const cuerpo = await respuesta.json();
      expect(cuerpo.retryAfterSegundos).toBe(3300);
      expect(respuesta.headers.get("Retry-After")).toBe("3300");
      expect(Number(respuesta.headers.get("Retry-After"))).toBe(cuerpo.retryAfterSegundos);
    },
  );

  it("no permitido -- registra el evento RECHAZADA saneado (nunca con cadenaId/empresaId/usuarioId/body/huella)", async () => {
    registrarIntentoMock.mockResolvedValue({
      contador: 31,
      permitido: false,
      buckets: [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 31 }],
    });
    const { POST } = await import("../route");
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(registrarEventoRateLimitConsultaMock).toHaveBeenCalledTimes(1);
    const [codigo, detalle] = registrarEventoRateLimitConsultaMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(codigo).toBe("CONSULTA_RATE_LIMIT_RECHAZADA");
    expect(Object.keys(detalle).sort()).toEqual(["catalogoId", "contador"]);
    expect(detalle.catalogoId).toBe("DEPENDENCIA_CRITICA");
    expect(detalle.contador).toBe(31);
  });

  it("registrarIntento falla (infraestructura) -- 503 SERVICIO_NO_DISPONIBLE, nunca llama al dispatcher, nunca expone el error crudo", async () => {
    registrarIntentoMock.mockRejectedValue(new Error("connection string invalida: postgres://user:secreto@host/db"));
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(respuesta.status).toBe(503);
    expect(await respuesta.json()).toEqual({ ok: false, error: "SERVICIO_NO_DISPONIBLE" });
    expect(ejecutarConsultaPermitidaMock).not.toHaveBeenCalled();
  });

  it("registrarIntento falla -- registra el evento INFRAESTRUCTURA sin ningun dato del error ni del contexto (nunca message/stack/cadenaId/empresaId/usuarioId/huella)", async () => {
    registrarIntentoMock.mockRejectedValue(new Error("connection string invalida: postgres://user:secreto@host/db"));
    const { POST } = await import("../route");
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(registrarEventoRateLimitConsultaMock).toHaveBeenCalledTimes(1);
    const [codigo, detalle] = registrarEventoRateLimitConsultaMock.mock.calls[0] as [string, Record<string, unknown> | undefined];
    expect(codigo).toBe("CONSULTA_RATE_LIMIT_INFRAESTRUCTURA");
    expect(detalle ?? {}).toEqual({});
  });

  it("el limite se evalua DESPUES de validar el payload -- un payload invalido nunca llama a registrarIntento ni gasta cupo", async () => {
    const { POST } = await import("../route");
    await POST(construirRequest({ cadenaId: "cadena-1" })); // falta catalogoId -> DATOS_INVALIDOS
    expect(registrarIntentoMock).not.toHaveBeenCalled();
  });

  it("empresaId/usuarioId de la sesion SIEMPRE determinan la huella (nunca el payload) -- dos sesiones distintas producen huellas distintas", async () => {
    const { POST } = await import("../route");

    requireSessionMock.mockResolvedValue({ sesion: { ...SESION_ADMIN, empresaId: "empresa-A", usuarioId: "usuario-A" } });
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    const [huellaA] = registrarIntentoMock.mock.calls[0] as [string];

    registrarIntentoMock.mockClear();
    requireSessionMock.mockResolvedValue({ sesion: { ...SESION_ADMIN, empresaId: "empresa-B", usuarioId: "usuario-B" } });
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    const [huellaB] = registrarIntentoMock.mock.calls[0] as [string];

    expect(huellaA).toMatch(/^[0-9a-f]{64}$/); // sha256 hex -- nunca el empresaId/usuarioId en claro
    expect(huellaB).toMatch(/^[0-9a-f]{64}$/);
    expect(huellaA).not.toBe(huellaB);
  });

  it("la misma sesion produce siempre la misma huella (determinista, para que el conteo acumule entre requests)", async () => {
    const { POST } = await import("../route");
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    const [huella1] = registrarIntentoMock.mock.calls[0] as [string];

    registrarIntentoMock.mockClear();
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    const [huella2] = registrarIntentoMock.mock.calls[0] as [string];

    expect(huella1).toBe(huella2);
  });

  it("usa el bucket CONSULTA_EJECUTAR y el limite LIMITE_CONSULTA_EJECUTAR (no reutiliza un bucket de otra pregunta/ruta)", async () => {
    const { POST } = await import("../route");
    const { LIMITE_CONSULTA_EJECUTAR } = await import("@/infra/rateLimit/limiteTasa");
    await POST(construirRequest(PAYLOAD_SIN_PERIODO));

    expect(registrarIntentoMock).toHaveBeenCalledTimes(1);
    const [, bucket, limite] = registrarIntentoMock.mock.calls[0] as [string, string, number];
    expect(bucket).toBe("CONSULTA_EJECUTAR");
    expect(limite).toBe(LIMITE_CONSULTA_EJECUTAR);
  });
});

describe("POST /ejecutar -- latencia total de punta a punta (Incremento 5 PR4)", () => {
  it("camino feliz (ok:true) -- registra CONSULTA_LATENCIA_TOTAL exactamente una vez, con duracionMs numerico >= 0, statusHttp=200 y el catalogoId ya validado", async () => {
    const respuestaOk = {
      ok: true,
      catalogoId: "OTIF_CAIDA",
      respuestaDirecta: "El OTIF se mantuvo.",
      periodo: { inicio: "2026-09-01", fin: "2026-09-30" },
      filtros: {},
      fuente: "ObservacionKpi",
      formula: "numerador/denominador",
      numerador: 90,
      denominador: 100,
      calidad: { faltantes: [], cobertura: 1 },
      hecho: "El OTIF del periodo fue 90%.",
      interpretacion: "Se mantuvo respecto al periodo anterior.",
      accion: "Ninguna accion urgente.",
      comoComprobar: "Revisa ObservacionKpi del periodo.",
      ruleVersion: "consultas-v1",
    };
    ejecutarConsultaPermitidaMock.mockResolvedValue(respuestaOk);
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_CON_PERIODO));
    expect(respuesta.status).toBe(200);

    expect(registrarEventoLatenciaConsultaMock).toHaveBeenCalledTimes(1);
    const [codigo, detalle] = registrarEventoLatenciaConsultaMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(codigo).toBe("CONSULTA_LATENCIA_TOTAL");
    expect(typeof detalle.duracionMs).toBe("number");
    expect(detalle.duracionMs as number).toBeGreaterThanOrEqual(0);
    expect(detalle.statusHttp).toBe(200);
    expect(detalle.catalogoId).toBe("OTIF_CAIDA");
  });

  it("sesion invalida (rechazada antes de leer el body) -- SI registra el evento, pero SIN catalogoId (nunca se llego a validar el payload)", async () => {
    const { NextResponse } = await import("next/server");
    requireSessionMock.mockResolvedValue({ respuesta: NextResponse.json({ ok: false, error: "NO_SESION" }, { status: 401 }) });

    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(401);

    expect(registrarEventoLatenciaConsultaMock).toHaveBeenCalledTimes(1);
    const [codigo, detalle] = registrarEventoLatenciaConsultaMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(codigo).toBe("CONSULTA_LATENCIA_TOTAL");
    expect(detalle.statusHttp).toBe(401);
    expect(detalle.catalogoId).toBeUndefined();
  });

  it("payload invalido (catalogoId fuera del catalogo cerrado) -- registra el evento con statusHttp=400 y SIN catalogoId (nunca llego a ser uno de los 6 literales validos)", async () => {
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest({ catalogoId: "SELECT * FROM x", cadenaId: "cadena-1" }));
    expect(respuesta.status).toBe(400);

    expect(registrarEventoLatenciaConsultaMock).toHaveBeenCalledTimes(1);
    const [, detalle] = registrarEventoLatenciaConsultaMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(detalle.statusHttp).toBe(400);
    expect(detalle.catalogoId).toBeUndefined();
  });

  it("limite de tasa rechazado (429) -- registra el evento con statusHttp=429 y el catalogoId ya conocido (se valido antes del rate limit)", async () => {
    registrarIntentoMock.mockResolvedValue({
      contador: 31,
      permitido: false,
      buckets: [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 31 }],
    });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(429);

    expect(registrarEventoLatenciaConsultaMock).toHaveBeenCalledTimes(1);
    const [, detalle] = registrarEventoLatenciaConsultaMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(detalle.statusHttp).toBe(429);
    expect(detalle.catalogoId).toBe("DEPENDENCIA_CRITICA");
  });

  it("PRESUPUESTO_COMPUTO_EXCEDIDO (503) -- el evento de latencia SIGUE registrandose (nunca se omite solo porque el presupuesto de computo ya descarto el resultado)", async () => {
    ejecutarConsultaPermitidaMock.mockResolvedValue({ ok: false, error: "PRESUPUESTO_COMPUTO_EXCEDIDO" });
    const { POST } = await import("../route");
    const respuesta = await POST(construirRequest(PAYLOAD_SIN_PERIODO));
    expect(respuesta.status).toBe(503);

    expect(registrarEventoLatenciaConsultaMock).toHaveBeenCalledTimes(1);
    const [, detalle] = registrarEventoLatenciaConsultaMock.mock.calls[0] as [string, Record<string, unknown>];
    expect(detalle.statusHttp).toBe(503);
    expect(detalle.catalogoId).toBe("DEPENDENCIA_CRITICA");
  });
});
