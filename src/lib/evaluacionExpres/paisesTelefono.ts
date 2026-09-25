// Infraestructura de cliente -- catalogo de paises para el selector de
// codigo telefonico del formulario de desbloqueo de diagnostico completo
// (ResultadoForm.tsx). Lista curada (no las ~195 del mundo): Peru
// primero y por defecto -- el pais de OPERACION de la evaluacion sigue
// fijo en Peru (unico aprobado, ver MVP-DEFINITIVO.md Seccion 6.1/13
// decision #5), pero el codigo de pais del telefono es independiente de
// eso: quien completa el formulario de contacto puede escribir su
// numero desde cualquier pais, esto solo lo ayuda a formatearlo. Resto
// de Latinoamerica primero, despues los mercados con los que ChainPulse
// podria tener contacto comercial. Ampliar la lista es agregar una fila,
// no un cambio de arquitectura.
export interface PaisTelefono {
  codigoIso2: string;
  nombre: string;
  indicativo: string;
}

// Bandera emoji a partir del codigo ISO 3166-1 alpha-2, sin hardcodear
// cada emoji uno por uno: cada letra se mapea a su simbolo indicador
// regional Unicode (U+1F1E6 = "A"), que el sistema operativo combina en
// la bandera del pais. Deterministico y testeable sin depender de una
// tabla de 195 filas.
export function banderaPais(codigoIso2: string): string {
  return codigoIso2
    .toUpperCase()
    .split("")
    .map((letra) => String.fromCodePoint(127397 + letra.charCodeAt(0)))
    .join("");
}

export const PAISES_TELEFONO: PaisTelefono[] = [
  { codigoIso2: "PE", nombre: "Perú", indicativo: "+51" },
  { codigoIso2: "AR", nombre: "Argentina", indicativo: "+54" },
  { codigoIso2: "BO", nombre: "Bolivia", indicativo: "+591" },
  { codigoIso2: "BR", nombre: "Brasil", indicativo: "+55" },
  { codigoIso2: "CL", nombre: "Chile", indicativo: "+56" },
  { codigoIso2: "CO", nombre: "Colombia", indicativo: "+57" },
  { codigoIso2: "CR", nombre: "Costa Rica", indicativo: "+506" },
  { codigoIso2: "CU", nombre: "Cuba", indicativo: "+53" },
  { codigoIso2: "DO", nombre: "República Dominicana", indicativo: "+1" },
  { codigoIso2: "EC", nombre: "Ecuador", indicativo: "+593" },
  { codigoIso2: "SV", nombre: "El Salvador", indicativo: "+503" },
  { codigoIso2: "GT", nombre: "Guatemala", indicativo: "+502" },
  { codigoIso2: "HN", nombre: "Honduras", indicativo: "+504" },
  { codigoIso2: "MX", nombre: "México", indicativo: "+52" },
  { codigoIso2: "NI", nombre: "Nicaragua", indicativo: "+505" },
  { codigoIso2: "PA", nombre: "Panamá", indicativo: "+507" },
  { codigoIso2: "PY", nombre: "Paraguay", indicativo: "+595" },
  { codigoIso2: "PR", nombre: "Puerto Rico", indicativo: "+1" },
  { codigoIso2: "UY", nombre: "Uruguay", indicativo: "+598" },
  { codigoIso2: "VE", nombre: "Venezuela", indicativo: "+58" },
  { codigoIso2: "US", nombre: "Estados Unidos", indicativo: "+1" },
  { codigoIso2: "CA", nombre: "Canadá", indicativo: "+1" },
  { codigoIso2: "ES", nombre: "España", indicativo: "+34" },
  { codigoIso2: "PT", nombre: "Portugal", indicativo: "+351" },
  { codigoIso2: "FR", nombre: "Francia", indicativo: "+33" },
  { codigoIso2: "DE", nombre: "Alemania", indicativo: "+49" },
  { codigoIso2: "IT", nombre: "Italia", indicativo: "+39" },
  { codigoIso2: "GB", nombre: "Reino Unido", indicativo: "+44" },
  { codigoIso2: "NL", nombre: "Países Bajos", indicativo: "+31" },
  { codigoIso2: "CH", nombre: "Suiza", indicativo: "+41" },
  { codigoIso2: "CN", nombre: "China", indicativo: "+86" },
  { codigoIso2: "JP", nombre: "Japón", indicativo: "+81" },
  { codigoIso2: "KR", nombre: "Corea del Sur", indicativo: "+82" },
  { codigoIso2: "IN", nombre: "India", indicativo: "+91" },
  { codigoIso2: "AU", nombre: "Australia", indicativo: "+61" },
  { codigoIso2: "ZA", nombre: "Sudáfrica", indicativo: "+27" },
];

export const PAIS_TELEFONO_DEFECTO = "PE";

export function paisTelefonoPorCodigo(codigoIso2: string): PaisTelefono | undefined {
  return PAISES_TELEFONO.find((pais) => pais.codigoIso2 === codigoIso2);
}
