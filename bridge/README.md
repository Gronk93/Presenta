# Presenta Bridge para Windows

Presenta Bridge conecta la PWA con aplicaciones de escritorio. Recibe comandos únicamente en `127.0.0.1:51794`, valida el origen web y exige el código local de seis dígitos.

## Funciones

- Envía flecha izquierda/derecha a la aplicación que esté presentando.
- Dibuja un láser digital sobre la pantalla seleccionada.
- Activa una capa negra temporal sin modificar la presentación.
- Se minimiza a la bandeja del sistema.
- No requiere permisos de administrador ni dependencias externas.

## Uso

1. Ejecuta `dist/PresentaBridge.exe` en Windows.
2. Selecciona la pantalla donde se proyectará la presentación.
3. En la vista receptora de la PWA, selecciona **Conectar Bridge**.
4. Escribe el código que muestra el ejecutable.
5. Mantén PowerPoint, el PDF o el navegador como ventana activa durante la presentación.

El Bridge está enfocado inicialmente en Windows 10/11 con Edge o Chrome.
