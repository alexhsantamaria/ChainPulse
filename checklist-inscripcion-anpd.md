# Checklist para la inscripción de bancos de datos personales ante la ANPD

**Preparado para:** Alex Santamaría — ChainPulse
**Fecha:** 16 de septiembre de 2026
**Base:** respuesta legal a la consulta de Ley 29733 (`consulta-abogado-ley29733.md`, `PLAN-DE-TRABAJO.md` Sección 18.2.G).

Este documento es una guía práctica para reunir la información y seguir los pasos del trámite de inscripción ante el Registro Nacional de Protección de Datos Personales, administrado por la Autoridad Nacional de Protección de Datos Personales (ANPD, Ministerio de Justicia y Derechos Humanos). No reemplaza el asesoramiento del abogado que ya revisó la consulta — está pensado para que el trámite se prepare y se presente con todo lo necesario en un solo intento, sin idas y vueltas.

## 1. Antes de empezar — información que hay que reunir

| Dato | Detalle | Estado |
|---|---|---|
| Razón social | Nombre legal completo de la empresa titular de ChainPulse | **Pendiente — dato de Alex** |
| RUC | Número de RUC de la empresa | **Pendiente — dato de Alex** |
| Domicilio legal | Dirección física registrada en Perú | **Pendiente — dato de Alex** |
| Representante legal | Nombre de quien puede firmar el trámite en representación de la empresa | **Pendiente — dato de Alex** |
| Correo de contacto de privacidad | Canal para solicitudes ARCO (sugerencia: `privacidad@chainpulse.pe`, requiere que el dominio esté disponible) | **Pendiente — decidir** |

Sin razón social, RUC y domicilio legal no se puede iniciar el trámite — es el primer bloqueante a resolver.

## 2. Los dos bancos de datos a inscribir

La recomendación legal es inscribir dos bancos de datos separados, porque tienen finalidades y bases legales de tratamiento distintas.

### Banco de datos 1 — "Prospectos y Usuarios Web"

- **Finalidad:** atender la solicitud de diagnóstico detallado de la evaluación exprés pública, y (solo si la persona lo autoriza por separado) mejorar los algoritmos del producto con datos reales.
- **Base legal:** consentimiento libre, previo, informado, expreso e inequívoco (checkbox sin premarcar).
- **Categorías de datos:** correo electrónico, nombre completo, nombre de empresa, teléfono (opcional).
- **Origen de los datos:** proporcionados directamente por el titular a través del formulario público del sitio.
- **Plazo de conservación:** indefinido mientras no se solicite la eliminación (ver Política de Privacidad, Sección 5).
- **Transferencia internacional:** sí — los datos se almacenan y procesan en Neon Inc. y Vercel Inc., con servidores en Estados Unidos.
- **Medidas de seguridad:** HTTPS, control de acceso, registro de auditoría, cifrado en tránsito.

### Banco de datos 2 — "Clientes y Usuarios SaaS"

- **Finalidad:** gestión de cuentas corporativas, facturación, soporte técnico y ejecución de la relación contractual del software.
- **Base legal:** ejecución de una relación contractual (no requiere consentimiento separado para esta finalidad).
- **Categorías de datos:** correo, nombre, datos de la empresa, credenciales de acceso.
- **Origen de los datos:** proporcionados directamente por el titular al registrar una cuenta.
- **Plazo de conservación:** mientras dure la relación contractual y conforme a las obligaciones legales aplicables.
- **Transferencia internacional:** sí — misma infraestructura que el banco de datos 1.
- **Medidas de seguridad:** las mismas que el banco de datos 1, más aislamiento técnico entre los datos de cada empresa cliente (multi-tenant).

## 3. Dónde y cómo se presenta el trámite

El trámite se presenta ante la Autoridad Nacional de Protección de Datos Personales (ANPD), a través de su Registro Nacional de Protección de Datos Personales. El canal y el formulario exactos (mesa de partes virtual, plataforma en línea del RNPDP, o presencial) pueden haber cambiado desde la fecha de este documento — se recomienda confirmar el canal vigente directamente en el portal del Ministerio de Justicia y Derechos Humanos o con el abogado que ya revisó la consulta, antes de presentar el trámite.

## 4. Plazos a planificar

- **Plazo legal de resolución:** 30 días hábiles desde la presentación de la solicitud.
- **Silencio administrativo positivo:** si la ANPD no se pronuncia dentro de esos 30 días hábiles, la inscripción se entiende aprobada.
- **Margen práctico por subsanación:** si la autoridad observa algo en la solicitud, suele otorgar un plazo adicional de 10 días hábiles para corregirlo.
- **Recomendación de planificación:** reservar entre 35 y 45 días hábiles (aproximadamente 1.5 a 2 meses) entre el inicio del trámite y la fecha en la que se quiere abrir el Incremento 2 (evaluación exprés) a tráfico público general.

## 5. Qué se declara junto con la inscripción

- **Flujo transfronterizo de datos:** se declara como parte del mismo trámite de inscripción, indicando los proveedores (Neon Inc., Vercel Inc.) y el país de destino (Estados Unidos).
- **Finalidades, usos previstos y sistema de tratamiento** de cada banco de datos, según el detalle de la Sección 2 de este documento.

## 6. Checklist final antes de presentar el trámite

- [ ] Razón social, RUC, domicilio legal y representante legal confirmados.
- [ ] Política de Privacidad publicada en el sitio (ver `politica-privacidad-chainpulse.md`), con los datos legales ya completos (no los placeholders del borrador).
- [ ] Canal de contacto de privacidad (correo) definido y funcionando.
- [ ] Ficha de cada banco de datos completa (Sección 2 de este documento).
- [ ] Declaración de flujo transfronterizo redactada.
- [ ] Trámite presentado ante la ANPD — anotar la fecha de presentación, porque de ahí se cuentan los 30 días hábiles.
- [ ] Seguimiento a los 30 días hábiles: confirmar si hubo pronunciamiento, observación a subsanar, o si aplica silencio administrativo positivo.

---

*Este documento es una guía de preparación, no un dictamen legal ni un formulario oficial. El trámite en sí y cualquier duda sobre el procedimiento exacto deben confirmarse con el abogado que ya revisó la consulta de Ley 29733.*
