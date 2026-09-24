// Prueba ClienteAlmacenamientoMemoria (implementacion en memoria de
// ClienteAlmacenamiento, ver almacenamiento.ts) y construirClaveObjetoCifrado
// -- ambas puras/sin red, corren en Mac/CI sin credenciales de R2.
import { describe, expect, it } from "vitest";
import { construirClaveObjetoCifrado } from "../almacenamiento";
import { ClienteAlmacenamientoMemoria } from "../almacenamientoMemoria";

describe("construirClaveObjetoCifrado", () => {
  it("incluye el empresaId como prefijo (aislamiento por tenant verificable)", () => {
    const clave = construirClaveObjetoCifrado("empresa-1", "import-1");
    expect(clave.startsWith("empresas/empresa-1/")).toBe(true);
  });

  it("dos importaciones distintas de la misma empresa producen claves distintas", () => {
    const a = construirClaveObjetoCifrado("empresa-1", "import-1");
    const b = construirClaveObjetoCifrado("empresa-1", "import-2");
    expect(a).not.toBe(b);
  });

  it("nunca incluye el nombre de archivo original del usuario -- nombre fijo por diseno", () => {
    const clave = construirClaveObjetoCifrado("empresa-1", "import-1");
    expect(clave).toBe("empresas/empresa-1/imports/import-1/cifrado.bin");
  });
});

describe("ClienteAlmacenamientoMemoria", () => {
  it("sube y descarga el mismo contenido exacto", async () => {
    const cliente = new ClienteAlmacenamientoMemoria();
    const contenido = Buffer.from("contenido de prueba");
    await cliente.subirObjeto("clave-1", contenido);
    const descargado = await cliente.descargarObjeto("clave-1");
    expect(descargado.equals(contenido)).toBe(true);
  });

  it("existeObjeto refleja subidas y eliminaciones", async () => {
    const cliente = new ClienteAlmacenamientoMemoria();
    expect(await cliente.existeObjeto("clave-1")).toBe(false);
    await cliente.subirObjeto("clave-1", Buffer.from("x"));
    expect(await cliente.existeObjeto("clave-1")).toBe(true);
    await cliente.eliminarObjeto("clave-1");
    expect(await cliente.existeObjeto("clave-1")).toBe(false);
  });

  it("descargarObjeto lanza para una clave que no existe (nunca devuelve buffer vacio en silencio)", async () => {
    const cliente = new ClienteAlmacenamientoMemoria();
    await expect(cliente.descargarObjeto("no-existe")).rejects.toThrow(/no existe/);
  });

  it("subirObjeto hace copia defensiva -- mutar el buffer original despues de subir no afecta lo guardado", async () => {
    const cliente = new ClienteAlmacenamientoMemoria();
    const original = Buffer.from("contenido original");
    await cliente.subirObjeto("clave-1", original);
    original[0] = 0;
    const descargado = await cliente.descargarObjeto("clave-1");
    expect(descargado.toString()).toBe("contenido original");
  });
});
