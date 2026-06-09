# X Cleaner

Una extensión ligera para Chrome / Chromium que oculta promociones y módulos molestos en X (antes Twitter).

## Características

- Oculta publicaciones promocionadas con una heurística más robusta basada en múltiples señales DOM
- Permite ajustar la sensibilidad del detector desde el popup
- Puede desactivar sugerencias de "A quién seguir" y el panel de tendencias/sidebar
- Incluye modo debug con badge en vivo y explicación de por qué un bloque fue marcado
- Usa permisos mínimos: `storage` y permisos de host solo para `x.com` / `twitter.com`
- Basada en filtrado DOM, sin bloquear tráfico de red

## Requisitos

- Chrome, Chromium o Microsoft Edge con soporte para extensiones MV3
- Navegador actualizado
- Acceso a `chrome://extensions` (o `edge://extensions` en Edge)
- Node.js reciente si quieres ejecutar las pruebas locales

## Instalación

1. Clona o descarga este repositorio en tu equipo.
2. Abre el navegador y ve a `chrome://extensions`.
3. Activa **Developer mode**.
4. Haz clic en **Load unpacked**.
5. Selecciona la carpeta del proyecto donde está este `README.md`.

> En Microsoft Edge el proceso es el mismo, pero comienza desde `edge://extensions`.

## Uso

1. Navega a `https://x.com/` o `https://twitter.com/`.
2. La extensión se activa automáticamente con el contenido de la página.
3. Si quieres cambiar opciones, abre el icono de la extensión y usa el popup.
4. Si X cambia su markup, activa `Debug mode` para inspeccionar las señales detectadas.

## Permisos

Esta extensión solicita solo los permisos necesarios:

- `storage`: para guardar opciones y preferencias localmente
- `https://x.com/*` y `https://twitter.com/*`: para inyectar el script en las páginas de X/Twitter

## Cómo funciona

- `x-cleaner-core.js` centraliza reglas, settings y heurísticas reutilizables
- `content.js` detecta promociones, procesa el feed y actualiza el panel de debug
- `content.css` aplica reglas de estilo para ocultar o marcar elementos
- `popup.js` y `popup.html` exponen opciones y sensibilidad del detector
- El filtrado es heurístico, por lo que puede requerir ajustes si X cambia su interfaz

## Pruebas

Ejecuta la suite básica de regresión con:

```bash
node --test x-cleaner-core.test.js
```

## Notas

- No es un bloqueador de anuncios de red completo; funciona sobre el DOM de la página
- Si X cambia su estructura de HTML, puede ser necesario actualizar selectores o señales
- Usa este proyecto como base y adáptalo a tus necesidades

## Contribuciones

Las mejoras son bienvenidas. Si quieres colaborar:

- Abre un issue para proponer cambios
- Envía un pull request con tu corrección
- Revisa que el comportamiento siga siendo compatible con MV3
