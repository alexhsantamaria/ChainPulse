// Motor — punto de entrada publico que reexporta las funciones de calculo del motor v1.
// Punto de entrada del motor v1 (ADR-0002: funcion pura, sin Prisma ni
// Next). infra/ es lo unico que deberia importar desde aqui fuera de los
// propios tests.
export { RULE_VERSION } from "./constantes";
export { calcularSalud } from "./salud";
export { calcularCriticidad } from "./criticidad";
export { calcularRiesgo } from "./riesgo";
export { calcularEslabonesMasDebiles } from "./eslabonMasDebil";
export { calcularIndiceIntegracion } from "./indiceIntegracion";
