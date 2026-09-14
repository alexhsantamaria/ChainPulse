import { beforeAll, describe, expect, it } from "vitest";

// NEXTAUTH_SECRET tiene que existir ANTES de importar el modulo (se lee
// una sola vez por llamada, pero conviene fijarlo desde el inicio del
// archivo para no depender del orden de los tests).
beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "secreto-de-pruebas-no-es-real";
});

describe("crearTokenInvitacion / verificarTokenInvitacion", () => {
  it("un token recien creado se verifica y devuelve los mismos datos", async () => {
    const { crearTokenInvitacion, verificarTokenInvitacion } = await import("../invitacion");
    const token = await crearTokenInvitacion({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });

    const payload = await verificarTokenInvitacion(token);

    expect(payload).toEqual({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });
  });

  it("un token con la firma alterada no se verifica", async () => {
    const { crearTokenInvitacion, verificarTokenInvitacion } = await import("../invitacion");
    const token = await crearTokenInvitacion({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });
    // Se altera el ANTEPENULTIMO caracter, no el ultimo: en base64url, el
    // ultimo caracter de una firma HS256 (32 bytes) codifica solo 4 bits
    // reales (los otros 2 son relleno fijo en cero) -- alterar justo ese
    // caracter puede, en un caso raro, no cambiar ningun bit real y dejar
    // la firma intacta (test intermitente encontrado en este entorno). El
    // anteultimo caracter no tiene ese problema: siempre codifica 6 bits
    // reales, asi que alterarlo siempre invalida la firma.
    const pos = token.length - 2;
    const tokenAlterado = token.slice(0, pos) + (token[pos] === "A" ? "B" : "A") + token.slice(pos + 1);

    expect(await verificarTokenInvitacion(tokenAlterado)).toBeNull();
  });

  it("una cadena que no es un JWT no se verifica", async () => {
    const { verificarTokenInvitacion } = await import("../invitacion");
    expect(await verificarTokenInvitacion("no-es-un-token")).toBeNull();
  });

  it("un token firmado con otro secreto no se verifica", async () => {
    const { crearTokenInvitacion } = await import("../invitacion");
    const token = await crearTokenInvitacion({
      empresaId: "empresa-1",
      eslabonId: "eslabon-1",
      email: "responsable@example.com",
    });

    process.env.NEXTAUTH_SECRET = "otro-secreto-distinto";
    const { verificarTokenInvitacion } = await import("../invitacion");
    expect(await verificarTokenInvitacion(token)).toBeNull();
    process.env.NEXTAUTH_SECRET = "secreto-de-pruebas-no-es-real";
  });
});
