// Infraestructura — crea el tenant y el administrador de una cuenta nueva (RF1, ADR-0003).
//
// No usa tenantClient() (src/infra/prisma/tenantClient.ts): esa capa
// envuelve CADA operacion en su propia transaccion, y crear una empresa +
// su administrador tiene que ser atomico (si el usuario falla por email
// duplicado, la empresa tampoco debe quedar creada). Por eso este es el
// unico lugar del proyecto, junto con loginLookup.ts, que abre su propia
// transaccion sobre el cliente base.
//
// El id de la empresa se genera aca, no con el @default(cuid()) de
// schema.prisma: la politica RLS de "empresas" (prisma/rls.sql) exige que
// app.tenant_id ya sea igual al id de la fila que se esta insertando. Como
// el id lo elegimos nosotros antes de tocar la base, alcanza con fijar la
// sesion a ese mismo valor -- no hace falta una funcion SECURITY DEFINER
// como login_lookup() (ahi el problema es distinto: el login no conoce el
// tenant de antemano; aca sí, porque lo estamos creando).
import { randomUUID } from "crypto";
import { tenantTransaction } from "../prisma/tenantTransaction";
import { hashPassword } from "./password";
import { generarSecretoMfa } from "./mfa";
import { EmailYaRegistradoError } from "./errores";

export interface RegistroInput {
  nombreEmpresa: string;
  email: string;
  password: string;
}

export interface RegistroResultado {
  empresaId: string;
}

export { EmailYaRegistradoError };

export async function registrarEmpresaYAdmin(input: RegistroInput): Promise<RegistroResultado> {
  const email = input.email.trim().toLowerCase();
  const empresaId = randomUUID();
  const passwordHash = await hashPassword(input.password);
  const { secretoBase32 } = generarSecretoMfa(email);

  try {
    // R5-11 (Ronda 5) -- antes, este archivo abria su propia
    // prisma.$transaction() + set_config manual (el mismo bloque de 3
    // lineas copiado en media docena de sitios de infra/). Ahora usa el
    // helper estandar (PLAN-DE-TRABAJO.md Seccion 18.3.B), que hace
    // exactamente lo mismo -- set_config + injectTenantFilter para los
    // modelos tenant-scoped -- desde un solo lugar.
    await tenantTransaction(empresaId, async (tx) => {
      await tx.empresa.create({ data: { id: empresaId, nombre: input.nombreEmpresa } });

      await tx.usuario.create({
        data: {
          empresaId,
          email,
          // RF1 no pide el nombre de la persona, solo el de la empresa y
          // las credenciales -- se puede completar/editar mas adelante
          // desde un perfil, cuando exista esa pantalla.
          nombre: "Administrador",
          rol: "ADMINISTRADOR",
          passwordHash,
          mfaSecret: secretoBase32,
          // mfaHabilitado queda en false (default del schema): ADR-0003
          // exige MFA para ADMINISTRADOR, pero se activa confirmando un
          // codigo en /activar-mfa, no en el momento del registro.
        },
      });
    });
  } catch (err) {
    // Duck-typing en vez de `instanceof Prisma.PrismaClientKnownRequestError`:
    // en modo engineType="client" ese tipo no queda re-exportado desde
    // "@prisma/client" (ver default.d.ts generado) -- el codigo de error
    // Prisma (P2002 = violacion de restriccion unica) si esta presente en
    // runtime, asi que se verifica directo.
    const codigo = err && typeof err === "object" && "code" in err ? (err as { code?: string }).code : undefined;
    if (codigo === "P2002") {
      throw new EmailYaRegistradoError();
    }
    throw err;
  }

  return { empresaId };
}
