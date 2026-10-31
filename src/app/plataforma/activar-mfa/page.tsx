// Pagina — activacion de MFA de plataforma (RF19, PR 8 correccion).
// Shell de servidor minimo: la cookie de preauth no es legible aca (ver
// comentario de ActivarMfaPlataformaCliente.tsx), asi que no hay ninguna
// verificacion de servidor que hacer en esta pagina -- el cliente la
// hace al llamar a /api/plataforma/mfa/enrolar.
import ActivarMfaPlataformaCliente from "./ActivarMfaPlataformaCliente";

export default function ActivarMfaPlataformaPage() {
  return <ActivarMfaPlataformaCliente />;
}
