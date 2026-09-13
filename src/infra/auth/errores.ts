// Infraestructura — errores compartidos de creacion de cuenta (RF1/RF4).
// Un mismo email global-unico (ADR-0003) puede chocar tanto al registrar
// una empresa nueva (registro.ts) como al aceptar una invitacion de
// responsable (aceptarInvitacion.ts) -- un solo error para los dos casos.
export class EmailYaRegistradoError extends Error {
  constructor() {
    super("EMAIL_YA_REGISTRADO");
  }
}
