# Consulta para abogado — Ley N.º 29733 (Protección de Datos Personales, Perú)

**Preparado para:** Alex Santamaría — ChainPulse
**Fecha:** 16 de septiembre de 2026
**Objetivo de este documento:** dar a un abogado especializado en protección de datos personales en Perú todo el contexto necesario para responder, en una sola revisión, si el flujo de datos descrito más abajo cumple con la Ley N.º 29733 y su reglamento, y qué haría falta ajustar antes de abrir el producto a tráfico público general.

---

## 1. Qué es ChainPulse, en una frase

ChainPulse es un software (SaaS) que ayuda a empresas peruanas a diagnosticar qué tan sólida es su cadena de suministro (proveedores, clientes, procesos internos), a partir de un cuestionario que responden personas de la propia empresa o, en una versión pública, cualquier visitante anónimo de internet.

Esta consulta se centra exclusivamente en la **versión pública y anónima** del producto (el flujo de "evaluación exprés"), porque es la única parte que recibe datos personales de personas que no tienen una relación contractual previa con ChainPulse y que, además, es la única parte todavía no revisada legalmente.

## 2. Qué datos se recogen, de quién, y cuándo — el flujo completo

El flujo tiene dos pasos, diseñados deliberadamente para pedir datos personales solo si la persona los necesita y los acepta a cambio de algo concreto:

**Paso 1 — Resultado "macro" (sin ningún dato personal).** Un visitante anónimo entra a una página pública, responde un cuestionario corto sobre su cadena de suministro (sin dar nombre, correo ni ningún dato identificable) y el sistema le muestra al instante un resultado general (un puntaje simple de salud/riesgo de su cadena). En este paso no se pide ni se guarda ningún dato personal.

**Paso 2 — Resultado "detallado" (requiere datos de contacto).** Si el visitante quiere ver el desglose completo de su diagnóstico (qué parte específica de su cadena es más débil y por qué), el sistema le pide, antes de mostrárselo:
- **Correo electrónico** (obligatorio)
- **Nombre completo** (obligatorio)
- **Nombre de la empresa** (obligatorio)
- **Teléfono** (opcional, no bloquea el acceso si se deja vacío)

Junto con estos datos, el sistema pide **dos consentimientos separados, presentados sin ninguna casilla premarcada** (la persona tiene que marcarlos activamente, uno no implica el otro):
1. Consentimiento para usar esos datos y enviarle el resultado detallado.
2. Consentimiento, independiente del anterior, para usar esos datos además para mejorar los algoritmos del producto con datos reales.

Un enlace a la política de privacidad es visible junto a este formulario en el momento de pedir el consentimiento.

**Qué pasa con esos datos después:**
- Si el visitante **no** llega a pedir el detalle (se queda solo con el resultado macro), el sistema nunca tuvo ningún dato personal suyo que guardar.
- Si el visitante **sí** pide el detalle y deja sus datos, esos datos (correo, nombre, empresa, teléfono) se guardan **indefinidamente junto con sus respuestas**, con el mismo criterio que se aplicaría a un usuario que se registra una cuenta — el razonamiento del producto es que, a diferencia de un dato recogido sin que la persona lo supiera, aquí la persona lo entregó de forma consciente y a cambio de algo (ver el resultado detallado), con aviso previo de para qué se usa.
- El sistema permite que **cualquier persona pida el borrado de sus datos de contacto en cualquier momento, sin necesidad de haber creado una cuenta** — al pedirlo, se elimina su correo/nombre/empresa/teléfono, y solo quedan los valores agregados y no identificables (estadísticas generales, nunca datos que permitan reconocer a esa persona).
- Por separado, el sistema guarda una "huella de origen" técnica (una combinación de IP/dispositivo, no el nombre de la persona) solo para prevenir abuso automatizado (por ejemplo, que un script mande miles de evaluaciones en minutos) — esa huella técnica se borra automáticamente a las 48-72 horas, sin relación con si la persona pidió o no el detalle.
- El registro de qué consentimiento se aceptó y cuándo (el "recibo" de que la persona autorizó cada uso) **nunca se borra**, incluso si la persona pide después que se borren sus datos de contacto — se conserva como evidencia de que hubo consentimiento válido, pero ya sin el dato personal identificable asociado.

**Dónde vive la infraestructura:** la base de datos (Neon) y el hosting de la aplicación (Vercel) son proveedores de infraestructura en la nube, cuyos servidores probablemente no están físicamente en Perú (esto todavía no se confirmó con precisión — ver pregunta 2 más abajo).

**Escala actual:** hoy el producto solo tiene dos empresas piloto usándolo, en un entorno controlado directamente por Alex — todavía no ha recibido tráfico del público en general. La intención es abrir el flujo público (el que se describe en este documento) a cualquier visitante de internet más adelante, y **antes de hacerlo** se quiere tener esta revisión legal resuelta.

## 3. Las 4 preguntas concretas que se necesitan responder

### Pregunta 1 — Registro ante la Autoridad Nacional de Protección de Datos Personales

¿El volumen y tipo de datos que se describen en la Sección 2 (correo, nombre completo, nombre de empresa y, opcionalmente, teléfono, entregados voluntariamente por visitantes de internet) obliga a ChainPulse a inscribir un banco de datos personales ante la Autoridad Nacional de Protección de Datos Personales del Perú? Si la respuesta es sí: ¿se necesita un solo registro, o uno separado para el flujo público anónimo (el descrito aquí) frente a los datos de las cuentas de empresas registradas (que es un flujo distinto, ya con relación contractual)? ¿Cuánto tiempo toma el trámite, para poder planificar la fecha de apertura al público en general?

### Pregunta 2 — Transferencia internacional de datos

Los datos se almacenan en Neon (base de datos) y se procesan a través de Vercel (hosting), dos proveedores de infraestructura en la nube cuyos servidores probablemente están fuera de Perú. El Artículo 15 de la Ley 29733 y su reglamento exigen, para transferir datos personales fuera del país, que el destino tenga un nivel de protección adecuado o que la persona dé un consentimiento explícito e informado específicamente para esa transferencia internacional. **El texto de consentimiento que hoy se le muestra al visitante (descrito en la Sección 2) no menciona la transferencia internacional de datos todavía.** Se necesita: (a) confirmar si los proveedores usados cuentan con un nivel de protección que la ley reconozca como adecuado, o si hace falta una cláusula contractual específica con ellos; y (b) si hace falta, el texto exacto que debe agregarse al consentimiento para cubrir este punto.

### Pregunta 3 — Suficiencia jurídica de los textos de consentimiento

El diseño actual ya sigue algunas buenas prácticas (ninguna casilla premarcada, dos consentimientos independientes y separados, un tercero y cuarto consentimiento planeados para etapas futuras del producto — ver nota más abajo), pero "casilla no premarcada" es necesario y no es, por sí solo, suficiente: la ley exige que el consentimiento sea libre, previo, informado, expreso e inequívoco, lo cual depende también del contenido real del texto que la persona lee antes de aceptar. Se necesita: revisar (o redactar) el texto exacto de cada consentimiento para confirmar que cumple ese estándar, y confirmar si basta con guardar qué versión del texto aceptó cada persona y una copia de ese texto (que es lo que el sistema ya está diseñado para hacer) como evidencia de consentimiento válido.

*Nota de contexto para el abogado:* el diseño del producto contempla, en etapas futuras (todavía no construidas), otros dos consentimientos separados para usos distintos — uno para incluir los datos en estudios agregados de investigación, y otro para fines comerciales/estadísticos de mercado. El principio de diseño es que cada finalidad tiene su propio consentimiento independiente, nunca agrupado. Si es útil revisar el listado completo de las 4 finalidades previstas antes de que se construyan, puede pedirse por separado.

### Pregunta 4 — Validación del umbral de anonimato usado para publicar datos agregados

Cuando ChainPulse publique estadísticas agregadas de mercado (comparando cadenas de suministro entre varias empresas, sin identificar a ninguna en particular — funcionalidad todavía no construida, planeada para más adelante), la regla de diseño actual es no publicar ningún dato agregado que represente a menos de **20 organizaciones distintas** (para que no sea posible, combinando la información publicada, deducir el dato de una empresa puntual). Este número (20) es una decisión de producto tomada por Alex, no una cifra validada legalmente. Se necesita confirmar si 20 organizaciones es un umbral razonable considerando que el mercado peruano es relativamente pequeño y concentrado en varios sectores (lo que hace más fácil, con menos organizaciones, adivinar quién es quién por descarte) — y si la ley o alguna guía de la autoridad peruana exige algo adicional (por ejemplo, un umbral más alto, o controles adicionales) para este tipo de publicación agregada.

## 4. Dos puntos adicionales, más rápidos de confirmar

- **¿El "derecho de cancelación" choca con el registro de consentimiento que nunca se borra?** El sistema borra los datos de contacto (correo, nombre, empresa, teléfono) cuando la persona lo pide, pero conserva el registro de qué consentimiento aceptó y cuándo (sin el dato identificable) como evidencia legal. Se necesita confirmar que esto es correcto y no genera una expectativa incumplida de "borrado total".
- **¿La venta de datos agregados a un tercero necesita un registro o autorización aparte?** Más adelante (funcionalidad futura, no construida todavía) ChainPulse planea vender acceso a esas estadísticas agregadas de mercado (la misma funcionalidad de la Pregunta 4) a compradores interesados en el sector. Se necesita confirmar si esto, además del registro de banco de datos de la Pregunta 1, requiere algún trámite o autorización adicional ante la autoridad peruana.

## 5. Qué bloquea esta revisión y qué no

- **No bloquea:** seguir construyendo y probando el producto con las dos empresas piloto actuales, en el entorno controlado que ya existe hoy.
- **Si bloquea:** abrir el flujo público de evaluación anónima (descrito en la Sección 2) a cualquier visitante de internet en general. Esa apertura se pausa hasta tener, como mínimo, una respuesta clara a las Preguntas 1 y 2 (registro y transferencia internacional), que son las que tienen implicancia legal más directa e inmediata.
- La Pregunta 4 (umbral de 20 organizaciones) y el punto de venta de datos agregados de la Sección 4 son relevantes para una funcionalidad que todavía no está construida (se planea para más adelante) — no es urgente resolverlas ahora mismo, pero es más barato preguntarlas ya, en la misma consulta, que volver a contactar al abogado más adelante.

---

*Este documento fue preparado a partir de la documentación técnica interna de ChainPulse (especificación de requisitos y plan de trabajo), para que el abogado no necesite leer esos documentos técnicos directamente. Cualquier ajuste que el abogado indique (texto de consentimiento, cláusulas de transferencia internacional, trámite de registro) se puede aplicar directamente sobre el producto.*
