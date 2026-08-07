# Presenta Bridge para Windows

Presenta Bridge coloca el láser, el lápiz, las pizarras y la pantalla negra sobre PowerPoint en Windows. La PWA recibe los controles del celular por Internet y los entrega localmente al Bridge mediante `127.0.0.1:51794`, usando una contraseña aleatoria de ocho caracteres que puede renovarse desde el Bridge.

## Funciones

- Envía flecha izquierda/derecha a la aplicación que esté presentando.
- Dibuja un láser digital en vivo sobre la pantalla seleccionada.
- Permite escribir sobre PowerPoint o cubrirlo con una pizarra blanca o negra.
- Activa una capa negra temporal sin modificar la presentación.
- Se minimiza a la bandeja del sistema.
- Mantiene la capa de anotación por encima de PowerPoint en pantalla completa.
- Muestra el dispositivo conectado, el transporte y la hora de la última señal.
- No requiere permisos de administrador ni dependencias externas.

## Uso

1. Ejecuta `dist/PresentaBridgeSetup.exe` en Windows y selecciona **Instalar y abrir**.
2. Selecciona la pantalla donde se proyectará la presentación.
3. Abre la PWA de Presenta en la computadora y conecta el celular con el código de sala.
4. En la vista de la computadora selecciona **Conectar Bridge** e ingresa la contraseña del Bridge.
5. Abre PowerPoint y pulsa **Presentar PowerPoint directamente**.
6. Usa desde el celular el láser, lápiz, pizarra blanca/negra o pantalla negra.

El Bridge está enfocado inicialmente en Windows 10/11 con Edge o Chrome.
