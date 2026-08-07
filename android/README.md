# Presenta Android

Control remoto nativo que se conecta directamente a Presenta Bridge mediante Bluetooth Classic RFCOMM. No usa Internet, Wi‑Fi ni la PWA para enviar órdenes.

## Compilar

Requiere Android Studio con SDK Platform 36.1 y Build Tools 36.1.0 instalados.

```powershell
powershell -ExecutionPolicy Bypass -File android\build.ps1
```

El APK firmado se genera en `android\dist\PresentaAndroid.apk` y se copia a `public\downloads\PresentaAndroid.apk`. La firma y su contraseña quedan en `android\.signing`; esa carpeta se ignora en Git y debe conservarse para poder publicar actualizaciones compatibles.

## Conectar

1. Emparejar una sola vez el celular y la laptop desde la configuración Bluetooth de Windows.
2. Abrir Presenta Bridge y copiar la contraseña de ocho caracteres.
3. Instalar y abrir Presenta Android, escribir la contraseña y pulsar **Conectar**.
4. Mantener Presenta Bridge en ejecución. La app Android mantiene un servicio visible para recuperar la conexión después de bloquear el celular o de una interferencia.
