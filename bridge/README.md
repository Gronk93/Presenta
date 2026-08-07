# Presenta Bridge para Windows

Presenta Bridge conecta PowerPoint y la pantalla de Windows con Presenta Android por Bluetooth directo. También conserva el enlace local con la PWA en `127.0.0.1:51794`. Ambos modos exigen una contraseña aleatoria de ocho caracteres que puede renovarse desde el Bridge.

## Funciones

- Envía flecha izquierda/derecha a la aplicación que esté presentando.
- Dibuja un láser digital sobre la pantalla seleccionada.
- Activa una capa negra temporal sin modificar la presentación.
- Se minimiza a la bandeja del sistema.
- Busca automáticamente celulares Android emparejados y recupera el enlace Bluetooth tras una interferencia.
- Muestra el modelo del celular conectado, el transporte y la hora de la última señal.
- No requiere permisos de administrador ni dependencias externas.

## Uso

1. Ejecuta `dist/PresentaBridgeSetup.exe` en Windows y selecciona **Instalar y abrir**.
2. Selecciona la pantalla donde se proyectará la presentación.
3. Empareja una sola vez Android y Windows desde la configuración Bluetooth.
4. Instala Presenta Android, escribe la contraseña que muestra el Bridge y pulsa **Conectar**.
5. Opcionalmente, en la vista receptora de la PWA selecciona **Conectar Bridge** e ingresa la misma contraseña.
6. Mantén PowerPoint, el PDF o el navegador como ventana activa durante la presentación.

El Bridge está enfocado inicialmente en Windows 10/11 con Edge o Chrome.
