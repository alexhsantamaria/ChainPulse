// Infraestructura — determina si una Conexion tiene los 5 datos de RF3
// confirmados ("completa"), y por lo tanto entra en el calculo de RF7
// (eslabon mas debil) y RF16 (indice de integracion).
//
// Funcion pura (sin Prisma) a proposito: la usan tanto la ruta de creacion
// como la de edicion de una conexion, y es mas facil de probar aislada que
// mezclada con el acceso a datos — mismo criterio que src/engine/.
export interface DatosCriticidadConexion {
  gradoDependencia?: string | null;
  impactoPromesaCliente?: string | null;
  tieneAlternativa?: boolean | null;
  tiempoTolerable?: string | null;
  tiempoRecuperacion?: string | null;
}

// RF3: los 5 datos exigidos -- grado de dependencia, impacto sobre la
// promesa al cliente, si existe alternativa, tiempo tolerable y tiempo de
// recuperacion. "tieneAlternativa" es un boolean: false es una respuesta
// valida (no tiene alternativa), asi que se distingue de "no respondido"
// comparando contra null/undefined explicitamente, no con un check de
// truthiness.
export function calcularCompletitud(datos: DatosCriticidadConexion): boolean {
  return (
    datos.gradoDependencia != null &&
    datos.impactoPromesaCliente != null &&
    datos.tieneAlternativa != null &&
    datos.tiempoTolerable != null &&
    datos.tiempoRecuperacion != null
  );
}
