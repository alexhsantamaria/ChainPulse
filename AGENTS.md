# Reglas operativas obligatorias para agentes

Estas reglas aplican a todo el repositorio ChainPulse y prevalecen sobre
suposiciones basadas únicamente en la forma de una ruta local.

## Repositorio autoritativo para el trabajo cotidiano

- El repositorio del Mac es la ubicación autoritativa para leer y escribir
  código, documentación y artefactos del proyecto, y para preparar ramas,
  commits, pushes y pull requests:
  `/Users/alx/Documents/BigDevelopment/Proyectos/ChainPulse`.
- En sesiones ejecutadas desde Windows, ese mismo repositorio del Mac puede
  aparecer como `\\Mac\Home\Documents\BigDevelopment\Proyectos\ChainPulse`
  o `C:\Mac\Home\Documents\BigDevelopment\Proyectos\ChainPulse`. Es otra
  vista del repositorio del Mac; no debe confundirse con el clon nativo de
  Windows.
- `Claude outputs` es únicamente una zona temporal para borradores. Todo
  entregable aprobado debe terminar dentro de la estructura correspondiente
  de este repositorio.

## Clon nativo de Windows: uso limitado

- `C:\Users\alx\Documents\BigDevelopment\Proyectos\ChainPulse` es un clon
  separado, destinado a validaciones manuales que requieren Windows, el
  `.env` real, binarios de Prisma o acceso autorizado a Neon.
- No exigir acceso al clon nativo de Windows para tareas documentales, cambios
  de código, ramas o commits que pueden realizarse en el repositorio del Mac.
- Si una operación realmente necesita Windows y la sesión no tiene acceso
  directo al clon nativo, detener solo esa operación y entregar al usuario el
  comando exacto que debe ejecutar allí. No afirmar que el repositorio del Mac
  es incorrecto ni trasladar el trabajo ordinario al clon de Windows.
- Nunca copiar archivos directamente entre ambos clones para sincronizarlos.
  GitHub es el único punto de sincronización: commit/push desde un clon y
  fetch/pull en el otro.

## Operaciones con base de datos

- No conectarse a Neon, solicitar credenciales, ejecutar Prisma, aplicar
  migraciones, seeds ni pruebas de integración sin autorización separada y
  explícita del usuario.
- Las operaciones autorizadas que necesiten el `.env` real o Neon se ejecutan
  desde el clon nativo de Windows, nunca desde la vista compartida del Mac.

## Verificación antes de actuar

- Antes de modificar archivos, comprobar la raíz del repositorio, la rama y
  `git status`.
- Preservar cualquier cambio preexistente del usuario y no mezclarlo con la
  tarea actual.
- No inventar resultados de comandos ejecutados en el otro clon. Distinguir
  siempre entre resultados observados y resultados reportados por el usuario.
