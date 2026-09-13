// Infraestructura — responsables elegibles para un ciclo de pulso (RF5/RF10):
// solo quienes tienen un eslabon asignado que participa (como origen o
// destino) de al menos una conexion "completa" (RF3) de la empresa. Un
// responsable de un eslabon sin ninguna conexion completa no tiene nada
// que responder todavia, y no cuenta ni como "esperado" para RF10.
import { tenantClient } from "../prisma/tenantClient";

export interface ResponsableElegible {
  id: string;
  email: string;
  nombre: string;
  eslabonId: string;
}

export async function obtenerResponsablesElegibles(empresaId: string): Promise<ResponsableElegible[]> {
  const client = tenantClient(empresaId);

  const [usuarios, conexionesCompletas] = await Promise.all([
    client.usuario.findMany({ where: { rol: "RESPONSABLE" } }),
    client.conexion.findMany({ where: { completa: true } }),
  ]);

  const eslabonesConConexionCompleta = new Set<string>();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  conexionesCompletas.forEach((c: any) => {
    eslabonesConConexionCompleta.add(c.origenId);
    eslabonesConConexionCompleta.add(c.destinoId);
  });

  return usuarios
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    .filter((u: any) => u.eslabonId && eslabonesConConexionCompleta.has(u.eslabonId))
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    .map((u: any) => ({ id: u.id as string, email: u.email as string, nombre: u.nombre as string, eslabonId: u.eslabonId as string }));
}
