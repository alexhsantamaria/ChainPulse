// Infraestructura — cierra un ciclo de pulso: calcula y persiste salud,
// criticidad, riesgo, el conjunto de eslabones mas debiles y el indice de
// integracion reales, usando el motor v1 ya probado (RF7).
//
// RespuestaCruda/ResultadoConexion/ResultadoCiclo no estan en
// TENANT_SCOPED_MODELS (ver tenantClient.ts) -- se leen/escriben con un
// set_config manual, mismo patron que aceptarInvitacion.ts y
// registrarRespuestas.ts.
import { prisma } from "../prisma/client";
import { tenantClient } from "../prisma/tenantClient";
import { calcularSalud } from "@/engine/salud";
import { calcularCriticidad } from "@/engine/criticidad";
import { calcularRiesgo } from "@/engine/riesgo";
import { calcularEslabonesMasDebiles } from "@/engine/eslabonMasDebil";
import { calcularIndiceIntegracion } from "@/engine/indiceIntegracion";
import { RULE_VERSION } from "@/engine/constantes";
import { calcularCobertura } from "./cobertura";
import { obtenerResponsablesElegibles } from "./responsablesElegibles";
import type { DatosCriticidad, RespuestaLikert, ValoresConexion, ConexionParaIndice } from "@/domain/types";

export class CicloNoAbiertoError extends Error {
  constructor() {
    super("El ciclo de pulso no esta abierto");
    this.name = "CicloNoAbiertoError";
  }
}

interface ConexionCompleta {
  id: string;
  datosCriticidad: DatosCriticidad;
}

export async function cerrarCiclo(
  empresaId: string,
  cicloPulsoId: string,
): Promise<{
  indiceIntegracion: number;
  eslabonesMasDebilesIds: string[];
  coberturaRespuesta: number | null;
}> {
  const client = tenantClient(empresaId);

  const ciclo = await client.cicloPulso.findUnique({ where: { id: cicloPulsoId } });
  if (!ciclo || ciclo.estado !== "ABIERTO") {
    throw new CicloNoAbiertoError();
  }

  const conexionesCompletasRaw = await client.conexion.findMany({ where: { completa: true } });
  const conexionesCompletas: ConexionCompleta[] =
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
    conexionesCompletasRaw.map((c: any) => ({
      id: c.id as string,
      datosCriticidad: {
        gradoDependencia: c.gradoDependencia,
        impactoPromesaCliente: c.impactoPromesaCliente,
        tieneAlternativa: c.tieneAlternativa,
        tiempoTolerable: c.tiempoTolerable,
        tiempoRecuperacion: c.tiempoRecuperacion,
      },
    }));

  const valoresParaEslabonMasDebil: ValoresConexion[] = [];
  const conexionesParaIndice: ConexionParaIndice[] = [];
  const responsablesQueRespondieron = new Set<string>();

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;

    for (const conexion of conexionesCompletas) {
      const respuestasCrudas = await tx.respuestaCruda.findMany({
        where: { cicloPulsoId, conexionId: conexion.id },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
      respuestasCrudas.forEach((r: any) => responsablesQueRespondieron.add(r.responsableId as string));

      const respuestasLikert: RespuestaLikert[] =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
        respuestasCrudas.map((r: any) => ({ valor: r.valor, noSabe: r.noSabe, noAplica: r.noAplica }));

      const resultadoSalud = calcularSalud(respuestasLikert);
      if (resultadoSalud.salud === null) {
        // Sin ninguna respuesta valida esta conexion no tiene salud este
        // ciclo -- no se persiste ResultadoConexion (RF10, cobertura
        // parcial): ausencia de dato, no un cero.
        continue;
      }

      const criticidad = calcularCriticidad(conexion.datosCriticidad);

      const resultadosAnteriores = await tx.resultadoConexion.findMany({
        where: { conexionId: conexion.id },
        orderBy: { createdAt: "asc" },
      });
      const historicoSalud: number[] =
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
        resultadosAnteriores.map((r: any) => r.salud as number);

      const riesgo = calcularRiesgo(
        criticidad,
        resultadoSalud.salud,
        historicoSalud,
        conexion.datosCriticidad.tieneAlternativa,
      );

      await tx.resultadoConexion.create({
        data: {
          cicloPulsoId,
          conexionId: conexion.id,
          salud: resultadoSalud.salud,
          criticidadSnapshot: conexion.datosCriticidad,
          gradoDependenciaSnapshot: conexion.datosCriticidad.gradoDependencia,
          riesgo,
          ruleVersion: RULE_VERSION,
        },
      });

      valoresParaEslabonMasDebil.push({
        conexionId: conexion.id,
        salud: resultadoSalud.salud,
        criticidad,
        gradoDependencia: conexion.datosCriticidad.gradoDependencia,
        riesgo,
      });
      conexionesParaIndice.push({
        salud: resultadoSalud.salud,
        criticidad,
        tieneAlternativa: conexion.datosCriticidad.tieneAlternativa,
      });
    }
  });

  const { conjuntoNoDominado } = calcularEslabonesMasDebiles(valoresParaEslabonMasDebil);
  const { indiceIntegracion } = calcularIndiceIntegracion(conexionesParaIndice);
  const eslabonesMasDebilesIds = conjuntoNoDominado.map((v) => v.conexionId);

  const responsablesElegibles = await obtenerResponsablesElegibles(empresaId);
  const coberturaRespuesta = calcularCobertura(responsablesElegibles.length, responsablesQueRespondieron.size);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- engineType="client" tipa PrismaClient como any (ver ADR-0003)
  await prisma.$transaction(async (tx: any) => {
    await tx.$executeRaw`SELECT set_config('app.tenant_id', ${empresaId}, true)`;
    await tx.resultadoCiclo.create({
      data: { cicloPulsoId, indiceIntegracion, eslabonesMasDebilesIds, ruleVersion: RULE_VERSION },
    });
  });

  await client.cicloPulso.update({
    where: { id: cicloPulsoId },
    data: { estado: "CERRADO", cerradoEn: new Date(), coberturaRespuesta },
  });

  return { indiceIntegracion, eslabonesMasDebilesIds, coberturaRespuesta };
}
