// Prueba las funciones puras de huella.ts (truncarVentanaBucket,
// hashHuellaOrigen), separadas a proposito de registrarIntento()
// (limiteTasa.ts), que ejecuta un UPSERT real contra Postgres y no se
// puede ejercitar sin red hacia Neon en este entorno de desarrollo — mismo
// limite documentado en src/infra/auth/__tests__/recuperacion.test.ts.
// registrarIntento() queda como candidato de prueba de integracion.
import { beforeEach, describe, expect, it } from "vitest";

describe("truncarVentanaBucket", () => {
  it("con la granularidad por defecto (15 min), trunca al inicio del bucket de 15 minutos (UTC)", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const fecha = new Date("2026-09-16T14:37:52.123Z");
    const truncada = truncarVentanaBucket(fecha);
    expect(truncada.toISOString()).toBe("2026-09-16T14:30:00.000Z");
  });

  it("dos fechas en el mismo bucket de 15 minutos truncan al mismo valor (misma fila de LimiteTasa)", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const a = truncarVentanaBucket(new Date("2026-09-16T14:30:00.000Z"));
    const b = truncarVentanaBucket(new Date("2026-09-16T14:44:59.999Z"));
    expect(a.getTime()).toBe(b.getTime());
  });

  it("dos fechas en buckets de 15 minutos distintos truncan a valores distintos", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const a = truncarVentanaBucket(new Date("2026-09-16T14:44:59.999Z"));
    const b = truncarVentanaBucket(new Date("2026-09-16T14:45:00.000Z"));
    expect(a.getTime()).not.toBe(b.getTime());
  });

  it("acepta una granularidad distinta por parametro (compatibilidad con la ventana vieja de 60 min)", async () => {
    const { truncarVentanaBucket } = await import("../huella");
    const truncada = truncarVentanaBucket(new Date("2026-09-16T14:37:52.123Z"), 60);
    expect(truncada.toISOString()).toBe("2026-09-16T14:00:00.000Z");
  });
});

describe("hashHuellaOrigen", () => {
  beforeEach(() => {
    delete process.env.HUELLA_ORIGEN_SALT;
  });

  it("lanza si HUELLA_ORIGEN_SALT no esta configurado (nunca hashea sin salto)", async () => {
    const { hashHuellaOrigen } = await import("../huella");
    expect(() => hashHuellaOrigen("203.0.113.4")).toThrow(/HUELLA_ORIGEN_SALT/);
  });

  it("el mismo valor con el mismo salto produce siempre el mismo hash", async () => {
    process.env.HUELLA_ORIGEN_SALT = "salto-de-pruebas-no-es-real";
    const { hashHuellaOrigen } = await import("../huella");
    expect(hashHuellaOrigen("203.0.113.4")).toBe(hashHuellaOrigen("203.0.113.4"));
  });

  it("nunca contiene el valor crudo (no es un hash reversible visible a simple vista)", async () => {
    process.env.HUELLA_ORIGEN_SALT = "salto-de-pruebas-no-es-real";
    const { hashHuellaOrigen } = await import("../huella");
    const hash = hashHuellaOrigen("203.0.113.4");
    expect(hash).not.toContain("203.0.113.4");
    expect(hash).toMatch(/^[0-9a-f]{64}$/); // sha256 en hex
  });

  it("un salto distinto produce un hash distinto para el mismo valor", async () => {
    const { hashHuellaOrigen } = await import("../huella");
    process.env.HUELLA_ORIGEN_SALT = "salto-A";
    const hashA = hashHuellaOrigen("203.0.113.4");
    process.env.HUELLA_ORIGEN_SALT = "salto-B";
    const hashB = hashHuellaOrigen("203.0.113.4");
    expect(hashA).not.toBe(hashB);
  });
});


describe("codificarHuellaConsultaAutenticada", () => {
  it("el mismo (empresaId, usuarioId) produce siempre el mismo valor crudo", async () => {
    const { codificarHuellaConsultaAutenticada } = await import("../huella");
    expect(codificarHuellaConsultaAutenticada("e1", "u1")).toBe(codificarHuellaConsultaAutenticada("e1", "u1"));
  });

  it("lleva el prefijo de separacion de dominio 'consulta-autenticada:v1'", async () => {
    const { codificarHuellaConsultaAutenticada } = await import("../huella");
    expect(codificarHuellaConsultaAutenticada("e1", "u1")).toMatch(/^consulta-autenticada:v1:/);
  });

  it("empresaId+usuarioId con limites distintos nunca colisionan (longitud-prefijado, no concatenacion naive)", async () => {
    const { codificarHuellaConsultaAutenticada } = await import("../huella");
    // Sin longitud-prefijada, "ab"+"c" y "a"+"bc" colisionarian en "abc".
    const a = codificarHuellaConsultaAutenticada("ab", "c");
    const b = codificarHuellaConsultaAutenticada("a", "bc");
    expect(a).not.toBe(b);
  });

  it("empresas/usuarios distintos producen valores distintos (separacion por usuario, no solo por empresa)", async () => {
    const { codificarHuellaConsultaAutenticada } = await import("../huella");
    const a = codificarHuellaConsultaAutenticada("e1", "u1");
    const b = codificarHuellaConsultaAutenticada("e1", "u2");
    const c = codificarHuellaConsultaAutenticada("e2", "u1");
    expect(a).not.toBe(b);
    expect(a).not.toBe(c);
    expect(b).not.toBe(c);
  });
});

describe("calcularSegundosHastaProximoIntentoPermitido", () => {
  const AHORA = new Date("2026-09-16T15:00:00.000Z");

  it("suma ya en o por debajo del limite -- devuelve 0 de inmediato (defensivo, no deberia invocarse en este caso)", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    const buckets = [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 10 }];
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, AHORA)).toBe(0);
  });

  it(
    "CORRECCION ronda 3 -- contador == limite exactamente ya NO devuelve 0: el PROXIMO intento " +
      "(contador + 1 = 31) excederia el limite, asi que hay que esperar a que ese bucket expire " +
      "(antes se asumia -- incorrectamente -- que el proximo intento era gratis)",
    async () => {
      const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
      const buckets = [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 30 }];
      // 14:45 + 60min = 15:45, AHORA = 15:00 -- faltan 45 min = 2700s.
      expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, AHORA)).toBe(2700);
    },
  );

  it("contador == limite + 1 (un solo bucket, apenas excedido) -- Retry-After = hasta que ESE bucket expire de la ventana de 60 min", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    // Bucket truncado a las 14:45, ahora son las 15:00 -- expira a las
    // 15:45 (14:45 + 60 min) -- faltan 45 minutos = 2700s.
    const buckets = [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 31 }];
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, AHORA)).toBe(2700);
  });

  it("el bucket MAS VIEJO es el que fija el Retry-After cuando con solo quitarlo ya alcanza", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    // Total 35 (viejo:20 + nuevo:15), limite 30. Quitar el mas viejo
    // (20) deja 15 < 30 -- el Retry-After depende de CUANDO expira el
    // bucket viejo (14:00), no del nuevo (14:45).
    const buckets = [
      { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 20 },
      { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 15 },
    ];
    // 14:00 + 60min = 15:00 = AHORA -- 0s restantes.
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, AHORA)).toBe(0);
  });

  it(
    "CORRECCION ronda 3 -- hace falta quitar VARIOS buckets: quitar el primero Y el segundo deja " +
      "exactamente el limite (30 <= 30, PERMITIDO ahora), pero el PROXIMO intento lo excederia " +
      "(31 > 30) -- antes esto devolvia 0 incorrectamente (el ejemplo exacto del bug de Alex)",
    async () => {
      const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
      // Total 50 (10+10+30), limite 30. Quitar el primero (10) deja 40
      // (sigue excedido). Quitar el segundo (10) deja 30 -- PERMITIDO
      // por si solo, pero el proximo intento (30+1=31) seguiria
      // recibiendo 429: hay que esperar tambien al TERCER bucket.
      const buckets = [
        { ventanaInicio: new Date("2026-09-16T13:45:00.000Z"), contador: 10 },
        { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 10 },
        { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 30 },
      ];
      // 14:45 + 60min = 15:45, AHORA = 15:00 -- faltan 45 min = 2700s
      // (no el de 14:00, que solo deja 30 == limite, insuficiente para
      // el PROXIMO intento).
      expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, AHORA)).toBe(2700);
    },
  );

  it(
    "ronda 3, bullet 1 de Alex -- buckets 1 + 30 (limite 30): NO debe alcanzar con solo vencer el " +
      "bucket de 1 (deja 30 == limite, insuficiente para el proximo intento) -- debe esperar a que " +
      "venza (una parte de) el bloque de 30",
    async () => {
      const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
      const buckets = [
        { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 1 }, // mas viejo
        { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 30 },
      ];
      const ahora = new Date("2026-09-16T14:50:00.000Z");
      // Quitar el de 14:00 deja 30 (== limite, NO < limite -- no alcanza).
      // Quitar tambien el de 14:45 deja 0 -- el Retry-After lo fija ESE
      // bucket: 14:45 + 60min = 15:45, desde las 14:50 faltan 55 min = 3300s.
      expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(3300);
    },
  );

  it(
    "ronda 3, bullet 2 de Alex -- buckets 1 + 29 (limite 30): al vencer el bucket de 1 quedan 29, y " +
      "el proximo intento (29 + 1 = 30 <= limite) SI estaria permitido -- no hace falta esperar al " +
      "bucket de 29",
    async () => {
      const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
      const buckets = [
        { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 1 }, // mas viejo
        { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 29 },
      ];
      const ahora = new Date("2026-09-16T14:50:00.000Z");
      // Quitar el de 14:00 deja 29 < 30 -- alcanza. Retry-After lo fija
      // ESE bucket: 14:00 + 60min = 15:00, desde las 14:50 faltan 10 min = 600s.
      expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(600);
    },
  );

  it(
    "ronda 3, bullet 3 de Alex -- varios buckets donde quitar el PRIMERO deja EXACTAMENTE el limite: " +
      "no alcanza (30 no es < 30), hay que seguir quitando hasta el SEGUNDO",
    async () => {
      const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
      // Total 40 (10+15+15), limite 30. Quitar el primero (10) deja
      // EXACTAMENTE 30 -- con la condicion vieja (<=) esto hubiera
      // detenido aca (expiracion 13:30+60=14:30, ya pasada desde las
      // 14:50 -- hubiera dado 0s, incorrecto). Con la condicion nueva
      // (<) sigue quitando: el segundo (15) deja 15 < 30, que si alcanza.
      const buckets = [
        { ventanaInicio: new Date("2026-09-16T13:30:00.000Z"), contador: 10 },
        { ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 15 },
        { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 15 },
      ];
      const ahora = new Date("2026-09-16T14:50:00.000Z");
      // Retry-After lo fija el bucket de 14:00 (el SEGUNDO, no el
      // primero): 14:00 + 60min = 15:00, desde las 14:50 faltan 10 min = 600s.
      expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(600);
    },
  );

  it(
    "ronda 3, bullet 4 de Alex -- varios buckets donde quitar el SEGUNDO deja limite - 1: ahi si se " +
      "detiene (29 < 30, el proximo intento -- 29 + 1 = 30 -- si estaria permitido)",
    async () => {
      const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
      // Total 36 (3+4+29), limite 30. Quitar el primero (3) deja 33
      // (sigue excedido, sin ambiguedad bajo cualquiera de las dos
      // condiciones). Quitar el segundo (4) deja 29 = limite - 1 -- ahi
      // si se detiene.
      const buckets = [
        { ventanaInicio: new Date("2026-09-16T13:00:00.000Z"), contador: 3 },
        { ventanaInicio: new Date("2026-09-16T13:30:00.000Z"), contador: 4 },
        { ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 29 },
      ];
      const ahora = new Date("2026-09-16T14:00:00.000Z");
      // Retry-After lo fija el SEGUNDO bucket (13:30): 13:30 + 60min =
      // 14:30, desde las 14:00 faltan 30 min = 1800s.
      expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(1800);
    },
  );

  it("todos los intentos en el bucket ACTUAL (un solo bucket vigente) -- Retry-After = 60 min desde su propia ventanaInicio", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    const ahora = new Date("2026-09-16T14:37:00.000Z");
    const bucketActual = new Date("2026-09-16T14:30:00.000Z"); // truncado a 15 min
    const buckets = [{ ventanaInicio: bucketActual, contador: 31 }];
    // 14:30 + 60min = 15:30 -- faltan 53 min desde 14:37 = 3180s.
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(3180);
  });

  it("frontera exacta de 15 minutos -- dos buckets truncados a bordes distintos no se confunden entre si", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    const ahora = new Date("2026-09-16T15:00:00.000Z");
    const buckets = [
      { ventanaInicio: new Date("2026-09-16T14:15:00.000Z"), contador: 31 }, // expira 15:15
      { ventanaInicio: new Date("2026-09-16T14:30:00.000Z"), contador: 0 },
    ];
    // Un solo bucket con contador excede el limite -- removerlo (el
    // unico con peso real) fija el Retry-After en su propia frontera de
    // 15 min (14:15), nunca en la del otro bucket (14:30).
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(900); // 15:15 - 15:00
  });

  it("frontera exacta de 1 hora (ventanaMinutos) -- si ahora cae justo en el instante de expiracion, Retry-After es 0, nunca negativo", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    const ahora = new Date("2026-09-16T15:00:00.000Z");
    const buckets = [{ ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 31 }];
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(0);
  });

  it("si ahora ya pasó el instante de expiracion (reloj avanzo mas de lo esperado) -- nunca devuelve un numero negativo", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    const ahora = new Date("2026-09-16T16:00:00.000Z"); // muy posterior a la expiracion
    const buckets = [{ ventanaInicio: new Date("2026-09-16T14:00:00.000Z"), contador: 31 }];
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora)).toBe(0);
  });

  it("usa reloj UTC explicitamente (fechas con offset distinto de Z se interpretan correctamente, no como UTC crudo)", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    // 10:45 hora local -05:00 == 15:45 UTC.
    const ahoraConOffset = new Date("2026-09-16T10:45:00.000-05:00");
    const buckets = [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 31 }];
    // 14:45Z + 60min = 15:45Z, que es exactamente ahoraConOffset -- 0s.
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahoraConOffset)).toBe(0);
  });

  it("acepta una ventanaMinutos distinta por parametro (compatibilidad con otras ventanas, no solo 60)", async () => {
    const { calcularSegundosHastaProximoIntentoPermitido } = await import("../huella");
    const ahora = new Date("2026-09-16T15:00:00.000Z");
    const buckets = [{ ventanaInicio: new Date("2026-09-16T14:45:00.000Z"), contador: 31 }];
    // Con una ventana de 30 min (no la de 60 por defecto): 14:45+30min = 15:15.
    expect(calcularSegundosHastaProximoIntentoPermitido(buckets, 30, ahora, 30)).toBe(900);
  });
});
