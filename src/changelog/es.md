## 0.3.0

#### Novedades
- Ver lo que has logrado: haz clic en 🏆 en la cinta lateral para ver las tareas completadas hoy, ayer, esta semana o la semana pasada, con un gráfico de 10 semanas.
- Cambia la fecha de vencimiento o la fecha programada de una tarea desde su menú contextual.
- Un comando **Alternar tarea completada**, junto a los de «en curso» y «cancelada».
- Las tareas que aún no pueden empezar o que esperan a otra tarea se muestran atenuadas.
- Lee los campos de Tasks en formato Dataview.

## 0.2.7

- Sin cambios. Se volvió a publicar la 0.2.6 para superar un problema en las comprobaciones de publicación de Obsidian.

## 0.2.6

#### Novedades
- **Filtro global de tareas**: una casilla cuenta como tarea solo si contiene uno de los textos que indiques, como en el plugin Tasks. Las opciones incluyen las subtareas y ocultan el texto del filtro en el panel.
- **En curso y cancelada**: comandos del editor y elementos del menú contextual marcan una tarea como en curso o cancelada. Ejecutarlos de nuevo la devuelve a abierta.

#### Correcciones
- Las tareas de notas con finales de línea de Windows no aparecían en el panel.
- Cancelar en el diálogo de edición de Tasks borraba la línea de la tarea.
- Por revisar perdía una tarea recién marcada, y las tareas descartadas volvían a aparecer.
- La búsqueda dejaba una categoría en pantalla aunque todas sus coincidencias estuvieran ocultas.

## 0.2.5

#### Novedades
- **Abrir enlaces desde el panel**: haz clic en un enlace de una tarea para abrirlo.

#### Correcciones
- Los #encabezados en wikilinks y los #fragmentos en URL desaparecían del texto de la tarea en el panel.

## 0.2.4

#### Novedades
- **Editar tarea**: abre una tarea en el diálogo de edición del plugin Tasks desde el menú contextual.
- **Ir a la tarea**: al abrir una tarea, su línea queda centrada, el cursor se coloca en ella y se resalta brevemente.
- Cada elemento del menú contextual tiene un icono cuando los menús nativos están desactivados en Ajustes → Apariencia.

## 0.2.3

#### Novedades
- **Más estados de casilla**: en curso `[/]`, reenviada `[>]` y programada `[<]` se muestran como tareas abiertas, y cancelada `[-]` cuenta como completada.
- El panel muestra los iconos de tu tema para estos estados.

## 0.2.2

#### Novedades
- **Primer día de la semana**: elígelo en los ajustes, y Esta semana y Próxima semana lo siguen.
- **Exclusiones al analizar toda la bóveda**: omite las carpetas y archivos que elijas. Las listas de carpetas y archivos se unen en una.

#### Correcciones
- Las secciones propias de los ajustes vuelven a verse bien en Obsidian 1.13 y posteriores. La sección «Getting Things Done» ahora se llama «General».
- A una subtarea cuya tarea principal no estaba en pantalla le faltaba la insignia ↖︎. Ahora su descripción emergente nombra a la tarea principal.

## 0.2.1

#### Novedades
- **Fecha de la tarea**: coloca las tareas por su fecha de vencimiento, su fecha programada, la más temprana de las dos o ninguna.
- **Categorías ordenadas por fecha**: las tareas se ordenan por fecha dentro de una categoría, las que no tienen fecha al final. Una categoría ordenada arrastrando y soltando conserva tu orden.
- **Fijar y desfijar**: fija una tarea en una categoría o desfíjala para que vuelva a seguir sus fechas.
- Marcas separadas de «vencida» y «mal clasificada», explicadas en la ventana emergente.
- **Regla Todo (comodín)**: recoge cada tarea con fecha que no tomaron las categorías de arriba. Algún día / Quizás la tiene por defecto.
- Los iconos siguen a Obsidian y a tu tema.

#### Correcciones
- Las notas añadidas después de iniciar Obsidian no aparecían hasta reiniciar.

## 0.2.0

#### Novedades
- **Un orden que se mantiene**: tu orden de arrastre sobrevive a ediciones de archivos, cambios de nombre, traslados de carpetas y reinicios.
- **Completar a través del plugin Tasks**: las tareas recurrentes obtienen su siguiente repetición y las fechas ✅ siguen las reglas de Tasks.
- Las tareas completadas permanecen en el panel hasta que recargas.
- **Campos del plugin Tasks**: prioridad, recurrencia, fechas y acciones al completar se muestran como insignias y en la ventana emergente, con ajustes para elegir cuáles.
- **Marcas de «vencida» y «mal clasificada»**, y una línea de vencimiento en la ventana emergente.
- Un icono en la cinta lateral abre el panel.

#### Correcciones
- Una tarea arrastrada a otra categoría caía en el sitio equivocado, y las subtareas se separaban de su tarea principal.
- Se abría un segundo panel al recargar o actualizar, y las categorías no cambiaban a medianoche.
- Los metadatos del plugin Tasks se colaban en el texto de la tarea, y aparecían descripciones emergentes durante el arrastre.
- El plugin pregunta antes de abrir su enlace de GitHub para comentarios.

## 0.1.9

#### Novedades
- Cada ámbito de análisis (toda la bóveda, carpetas, archivos) recuerda su propia lista.
- Un mensaje cuando no hay carpetas ni archivos elegidos para analizar.
- Los ajustes de comportamiento aparecen en la búsqueda de ajustes de Obsidian (Obsidian 1.13 y posteriores).
- Un banner de agradecimiento en los ajustes, con un enlace para compartir comentarios e ideas.

#### Correcciones
- Las referencias a bloques (^abc123) se perdían al escribir la categoría de una tarea.
- Tareas obsoletas tras cambiar el ámbito de análisis, y la imagen de celebración que a veces no aparecía.
- El aviso de cambio de idioma aparecía en la primera instalación.

## 0.1.8

#### Correcciones
- Se abría la línea equivocada de una tarea en una nota editada cerca del principio.

## 0.1.7

#### Novedades
- **12 idiomas**, según el idioma de Obsidian.
- Al abrir una tarea se usa la pestaña de su nota si ya está abierta.
- El texto de la tarea ocupa toda la fila; los botones de movimiento rápido aparecen al pasar el ratón.

## 0.1.6

#### Novedades
- Al pasar el ratón por una tarea se ven su nota y su número de línea.

## 0.1.5

#### Novedades
- **Búsqueda**: filtra el panel mientras escribes.
- Las versiones publicadas están firmadas, para que puedas comprobar que vienen del código fuente oficial.

## 0.1.4

#### Correcciones
- Las tareas bajo viñetas normales aparecían como subtareas de una tarea ajena.

## 0.1.3

#### Novedades
- El texto de la tarea muestra negrita, cursiva, tachado, código, resaltados y enlaces, como en tus notas.

## 0.1.2

#### Novedades
- Las tareas completadas tienen un botón para descartarlas, y **Descartar todas** en la cabecera las quita de una vez.

## 0.1.1

#### Novedades
- Los wikilinks del texto de la tarea se muestran en el panel.
- Los contadores de la barra de estado se pueden pulsar.

#### Correcciones
- Las descripciones emergentes de las tareas completadas, y los movimientos que fallaban por datos de tarea obsoletos.

## 0.1.0

#### Novedades
- El panel GTD: las tareas de tu bóveda agrupadas en Hoy, Esta semana, Algún día y más.
- Mueve tareas con un clic o arrastrando y soltando.
- Las subtareas siguen a su tarea principal.
- Contadores de tareas por categoría en la barra de estado.
- Animaciones de celebración al completar una tarea.
- Una vista compacta.
- La categoría se guarda como etiqueta en línea (#gtd/today) o como campo en línea de Dataview.
