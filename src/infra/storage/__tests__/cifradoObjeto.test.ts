// Prueba el cifrado de aplicacion de R2 (cifradoObjeto.ts) -- pura, sin
// red ni credenciales reales. Cubre los tres casos que Alex pidio
// explicitamente probar (2026-09-24, ver docs/ADR/0006-cifrado-r2.md):
// manipulacion del archivo, clave incorrecta, y acceso entre empresas
// (AAD). Tambien cubre el escenario de rotacion de clave maestra.
import { beforeEach, describe, expect, it } from "vitest";
import {
  cifrarContenido,
  descifrarContenido,
  envolverDek,
  desenvolverDek,
  generarDek,
  obtenerClaveMaestraActiva,
  obtenerClaveMaestraPorId,
} from "../cifradoObjeto";

function claveAleatoria(): Buffer {
  return generarDek(); // 32 bytes, sirve igual para DEK o clave maestra en pruebas
}

const EMPRESA_A = "empresa-a";
const IMPORT_1 = "import-1";

describe("cifrarContenido / descifrarContenido", () => {
  it("descifra exactamente el contenido original con la misma dek y el mismo empresaId/importId", () => {
    const dek = claveAleatoria();
    const original = Buffer.from("sku,ubicacion,inventario\nABC-001,LIMA-01,120\n", "utf8");
    const cifrado = cifrarContenido(original, dek, EMPRESA_A, IMPORT_1);
    const descifrado = descifrarContenido(cifrado, dek, EMPRESA_A, IMPORT_1);
    expect(descifrado.equals(original)).toBe(true);
  });

  it("el objeto cifrado nunca es igual al contenido en claro, ni lo contiene", () => {
    const dek = claveAleatoria();
    const original = Buffer.from("dato-secreto-reconocible", "utf8");
    const cifrado = cifrarContenido(original, dek, EMPRESA_A, IMPORT_1);
    expect(cifrado.equals(original)).toBe(false);
    expect(cifrado.includes("dato-secreto-reconocible")).toBe(false);
  });

  it("MANIPULACION: un objeto cifrado alterado (1 byte) nunca se descifra -- lanza, no devuelve basura", () => {
    const dek = claveAleatoria();
    const original = Buffer.from("contenido original", "utf8");
    const cifrado = cifrarContenido(original, dek, EMPRESA_A, IMPORT_1);
    const alterado = Buffer.from(cifrado);
    const posicion = alterado.length - 20;
    alterado.writeUInt8(alterado.readUInt8(posicion) ^ 0xff, posicion); // flip de un bit en medio del ciphertext
    expect(() => descifrarContenido(alterado, dek, EMPRESA_A, IMPORT_1)).toThrow();
  });

  it("CLAVE INCORRECTA: descifrar con una dek distinta a la que cifro lanza", () => {
    const dek = claveAleatoria();
    const otraDek = claveAleatoria();
    const cifrado = cifrarContenido(Buffer.from("x"), dek, EMPRESA_A, IMPORT_1);
    expect(() => descifrarContenido(cifrado, otraDek, EMPRESA_A, IMPORT_1)).toThrow();
  });

  it("ACCESO ENTRE EMPRESAS: descifrar declarando un empresaId distinto al que se uso para cifrar lanza, aunque la dek sea la correcta", () => {
    const dek = claveAleatoria();
    const cifrado = cifrarContenido(Buffer.from("dato de la empresa A"), dek, EMPRESA_A, IMPORT_1);
    expect(() => descifrarContenido(cifrado, dek, "empresa-b", IMPORT_1)).toThrow();
  });

  it("ACCESO ENTRE IMPORTACIONES: descifrar declarando un importId distinto al que se uso para cifrar lanza, aunque sea la misma empresa", () => {
    const dek = claveAleatoria();
    const cifrado = cifrarContenido(Buffer.from("dato de la importacion 1"), dek, EMPRESA_A, IMPORT_1);
    expect(() => descifrarContenido(cifrado, dek, EMPRESA_A, "import-2")).toThrow();
  });

  it("rechaza una dek que no mide 32 bytes", () => {
    const dekCorta = Buffer.from("demasiado-corta");
    expect(() => cifrarContenido(Buffer.from("x"), dekCorta, EMPRESA_A, IMPORT_1)).toThrow(/32 bytes/);
  });

  it("rechaza un objeto cifrado mas corto que iv+authTag", () => {
    const dek = claveAleatoria();
    expect(() => descifrarContenido(Buffer.from("corto"), dek, EMPRESA_A, IMPORT_1)).toThrow(/demasiado corto/);
  });

  it("dos cifrados del mismo contenido con la misma dek producen bytes distintos (nonce/iv unico por cifrado)", () => {
    const dek = claveAleatoria();
    const original = Buffer.from("mismo contenido");
    const cifradoUno = cifrarContenido(original, dek, EMPRESA_A, IMPORT_1);
    const cifradoDos = cifrarContenido(original, dek, EMPRESA_A, IMPORT_1);
    expect(cifradoUno.equals(cifradoDos)).toBe(false);
  });
});

describe("envolverDek / desenvolverDek", () => {
  it("desenvuelve exactamente la dek original con la misma clave maestra y el mismo empresaId/importId", () => {
    const dek = generarDek();
    const claveMaestra = claveAleatoria();
    const envuelta = envolverDek(dek, claveMaestra, EMPRESA_A, IMPORT_1);
    const desenvuelta = desenvolverDek(envuelta, claveMaestra, EMPRESA_A, IMPORT_1);
    expect(desenvuelta.equals(dek)).toBe(true);
  });

  it("CLAVE INCORRECTA: desenvolver con una clave maestra distinta lanza", () => {
    const dek = generarDek();
    const envuelta = envolverDek(dek, claveAleatoria(), EMPRESA_A, IMPORT_1);
    expect(() => desenvolverDek(envuelta, claveAleatoria(), EMPRESA_A, IMPORT_1)).toThrow();
  });

  it("ACCESO ENTRE EMPRESAS: desenvolver declarando otro empresaId lanza", () => {
    const dek = generarDek();
    const claveMaestra = claveAleatoria();
    const envuelta = envolverDek(dek, claveMaestra, EMPRESA_A, IMPORT_1);
    expect(() => desenvolverDek(envuelta, claveMaestra, "empresa-b", IMPORT_1)).toThrow();
  });

  it("la dekCifrada nunca contiene la dek en claro (base64 de bytes distintos)", () => {
    const dek = generarDek();
    const envuelta = envolverDek(dek, claveAleatoria(), EMPRESA_A, IMPORT_1);
    expect(Buffer.from(envuelta.dekCifrada, "base64").equals(dek)).toBe(false);
  });
});

describe("obtenerClaveMaestraActiva", () => {
  beforeEach(() => {
    delete process.env.R2_ENCRYPTION_KEY_ACTIVA;
    delete process.env.R2_ENCRYPTION_KEY_ACTIVA_ID;
    delete process.env.R2_ENCRYPTION_KEYS_ANTERIORES;
  });

  it("lanza si R2_ENCRYPTION_KEY_ACTIVA/_ID no estan configurados", () => {
    expect(() => obtenerClaveMaestraActiva()).toThrow(/R2_ENCRYPTION_KEY_ACTIVA/);
  });

  it("lanza si la clave no decodifica a 32 bytes", () => {
    process.env.R2_ENCRYPTION_KEY_ACTIVA_ID = "v1";
    process.env.R2_ENCRYPTION_KEY_ACTIVA = Buffer.from("corta").toString("base64");
    expect(() => obtenerClaveMaestraActiva()).toThrow(/32 bytes/);
  });

  it("devuelve id+clave cuando ambas variables estan bien configuradas", () => {
    process.env.R2_ENCRYPTION_KEY_ACTIVA_ID = "v1";
    process.env.R2_ENCRYPTION_KEY_ACTIVA = generarDek().toString("base64");
    const { id, clave } = obtenerClaveMaestraActiva();
    expect(id).toBe("v1");
    expect(clave.length).toBe(32);
  });
});

describe("obtenerClaveMaestraPorId -- rotacion de clave maestra", () => {
  beforeEach(() => {
    delete process.env.R2_ENCRYPTION_KEY_ACTIVA;
    delete process.env.R2_ENCRYPTION_KEY_ACTIVA_ID;
    delete process.env.R2_ENCRYPTION_KEYS_ANTERIORES;
  });

  it("devuelve la clave activa cuando el id pedido coincide con la activa", () => {
    const claveActiva = generarDek();
    process.env.R2_ENCRYPTION_KEY_ACTIVA_ID = "v2";
    process.env.R2_ENCRYPTION_KEY_ACTIVA = claveActiva.toString("base64");
    expect(obtenerClaveMaestraPorId("v2").equals(claveActiva)).toBe(true);
  });

  it("tras rotar, una DEK envuelta con la clave VIEJA se sigue pudiendo desenvolver via R2_ENCRYPTION_KEYS_ANTERIORES", () => {
    // Estado antes de rotar: v1 es la activa.
    const claveV1 = generarDek();
    process.env.R2_ENCRYPTION_KEY_ACTIVA_ID = "v1";
    process.env.R2_ENCRYPTION_KEY_ACTIVA = claveV1.toString("base64");
    const dek = generarDek();
    const envuelta = envolverDek(dek, claveV1, EMPRESA_A, IMPORT_1);

    // Rotacion: v2 pasa a ser la activa, v1 queda en "anteriores" (nunca
    // se borra hasta re-envolver o purgar todas las filas que la usan --
    // ver SEGURIDAD-credenciales.md).
    const claveV2 = generarDek();
    process.env.R2_ENCRYPTION_KEY_ACTIVA_ID = "v2";
    process.env.R2_ENCRYPTION_KEY_ACTIVA = claveV2.toString("base64");
    process.env.R2_ENCRYPTION_KEYS_ANTERIORES = JSON.stringify({ v1: claveV1.toString("base64") });

    // La fila vieja sigue apuntando a claveId="v1" (ImportacionCsv.cifradoClaveId) --
    // debe seguir desenvolviendose sin tocar el contenido en R2.
    const claveResuelta = obtenerClaveMaestraPorId("v1");
    const dekDesenvuelta = desenvolverDek(envuelta, claveResuelta, EMPRESA_A, IMPORT_1);
    expect(dekDesenvuelta.equals(dek)).toBe(true);
  });

  it("lanza un error claro (no generico) si el claveId no esta ni activo ni en anteriores", () => {
    process.env.R2_ENCRYPTION_KEY_ACTIVA_ID = "v2";
    process.env.R2_ENCRYPTION_KEY_ACTIVA = generarDek().toString("base64");
    expect(() => obtenerClaveMaestraPorId("v-fantasma")).toThrow(/v-fantasma/);
  });
});
