// Infraestructura — crea la cuenta de un responsable de eslabon al aceptar
// su invitacion (RF4). Analogo a registrarEmpresaYAdmin() (RF1, ver ese
// archivo): el codigo ya conoce el empresaId (viene del token firmado por
// invitacion.ts, no lo elige quien acepta), asi que alcanza con fijar
// app.tenant_id a ese id antes de insertar -- no hace falta una funcion
// SECURITY DEFINER nueva (misma resolucion que el addendum de RF1 en
// ADR-0003: alli el problema es distinto -- el login no conoce el tenant
// de antemano, aca si, porque lo trae el propio token).
import { tenantTransaction } from "../prisma/tenantTransaction";
import { hashPassword } from "./password";
import { EmailYaRegistradoError } from "./errores";

export interface AceptarInvitacionInput {
  empresaId: string;
  eslabonId: string;
  email: string;
  nombre: string;
  password: string;
}

export async function crearUsuarioResponsable(input: AceptarInvitacionInput): Promise<{ usuarioId: string }> {
  const email = input.email.trim().toLowerCase();
  const passwordHash = await hashPassword(input.password);

  try {
    // R5-11 -- ver el mismo comentario en registro.ts: usa el helper
    // estandar en vez de abrir su propia transaccion con set_config manual.
    const usuarioId = await tenantTransaction(input.empresaId, async (tx) => {
      const usuario = await tx.usuario.create({
        data: {
          empresaId: input.empresaId,
          eslabonId: input.eslabonId,
          email,
          nombre: input.nombre,
          rol: "RESPONSABLE",
          passwordHash,
          // MFA para RESPONSABLE queda diferido (ADR-0003, Decision):
          // mfaSecret null, mfaHabilitado en su default (false).
        },
      });
      return usuario.id as string;
    });
    return { usuarioId };
  } catch (err) {
    const codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (codigo === "P2002") {
      throw new EmailYaRegistradoError();
    }
    throw err;
  }
}
