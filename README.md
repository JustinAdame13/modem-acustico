# Módem acústico web

Transmite texto entre dos dispositivos usando solo la bocina y el micrófono.
Proyecto de la unidad 2 de Fundamentos de Telecomunicaciones (ITL).

No usa frameworks ni necesita instalar nada: es HTML, CSS y JavaScript.

## Cómo abrirlo

El micrófono solo funciona en `https://` o en `localhost`.

- **En la laptop:** abre una terminal en esta carpeta y ejecuta `python -m http.server 8000`
  (o usa la extensión Live Server de VS Code). Luego entra a `http://localhost:8000`.
- **En el celular y para la exposición:** sube la carpeta a Vercel (proyecto nuevo, sin
  framework, sin comando de build) y abre el enlace `https://...` en cada dispositivo.

Si solo haces doble clic en `index.html`, funciona el canal **Interno** (simulación),
pero puede que el navegador no dé acceso al micrófono.

## Cómo hacer la demostración

1. **Sin sonido, para explicar:** elige canal *Interno*. El emisor y el receptor están en la
   misma página. Usa "Dañar bits a propósito" para mostrar qué hace cada modo:
   - *Sin protección*: el texto llega cambiado y nadie se entera.
   - *Paridad + CRC*: aparece "Mensaje dañado".
   - *CRC + ARQ*: el receptor contesta NACK y el emisor retransmite.
   - *Hamming*: el bit se corrige solo (marcado con borde verde).
2. **Con una sola laptop:** canal *Aire* y marca "Probar con un solo dispositivo".
3. **Con dos dispositivos:** canal *Aire* y la misma velocidad en ambos. En el receptor pulsa
   *Escuchar*; en el emisor escribe y pulsa *Enviar por sonido*. Con ARQ el emisor también
   pide permiso de micrófono, porque tiene que oír el ACK.

Consejos: sube el volumen del emisor, empieza a 10 baudios y a menos de un metro, y deja
la pestaña visible (los navegadores frenan las pestañas en segundo plano).

## Mediciones (objetivo 4)

En el receptor escribe el mismo texto en "Texto esperado" y una nota como "2 m, con música".
Cada recepción agrega un renglón al registro con bits erróneos, bits corregidos, nivel de
señal en dB (atenuación) y relación señal/ruido. "Descargar CSV" lo exporta para graficar.

## La trama

```
PREÁMBULO     tono de 3500 Hz durante 300 ms
reposo        2 bits en 1
CABECERA      2 caracteres: control (modo y secuencia) y longitud. Siempre con Hamming.
DATOS         un carácter por byte del mensaje
CRC-16        2 caracteres (no va en "Sin protección")
```

Cada carácter es asíncrono: bit de arranque (0), datos y bit de parada (1).

| Formato  | Bits                                         | Se usa en              |
|----------|----------------------------------------------|------------------------|
| simple   | arranque + 8 datos + parada (10)             | Sin protección         |
| paridad  | arranque + 8 datos + paridad par + parada (11) | Paridad + CRC, CRC + ARQ |
| hamming  | arranque + 7 + 7 + parada (16)               | Hamming y la cabecera  |

Tonos (FSK): 0 = 1500 Hz, 1 = 2500 Hz, ACK = 4000 Hz, NACK = 5000 Hz.

## Archivos, en el orden en que conviene explicarlos

| Archivo | Qué hace | Tema |
|---|---|---|
| `js/config.js` | Frecuencias, tiempos y modos | |
| `js/crc.js` | División polinómica con XOR, igual que en las diapositivas | 2.4.3 |
| `js/hamming.js` | k1, k2, k3 y corrección por posición | 2.5.3 |
| `js/trama.js` | Arranque, parada, paridad (VRC), cabecera y CRC | Asíncrona, 2.4.1 |
| `js/modulador.js` | Bits a tonos: `sin(2π·f·t)` | Serie, FSK |
| `js/demodulador.js` | Tonos a bits: mide la energía de cada tono y vota | Ruido, atenuación |
| `js/audio.js` | Bocina, micrófono y canal interno | Medio no guiado |
| `js/app.js` | Botones, ARQ pare y espere, estadísticas | 2.5 ARQ, half dúplex |
| `js/vista.js` | Espectro en vivo y trama por colores | |
| `js/captura-worklet.js` | Pasa las muestras del micrófono a la página | |

## Pruebas automáticas

Con Node instalado: `node pruebas/pruebas.js`. Comprueba los ejemplos de las diapositivas
(CRC 1010 entre 1101 = 001; Hamming 1101 = 1100110 y el error en la posición 3) y pasa
tramas completas por un canal de audio simulado con ruido.

## Diferencias con la propuesta original

- Los tonos se generan muestra por muestra y se reproducen como un búfer, en lugar de usar
  `OscillatorNode`. Así el mismo código sirve para el canal interno y para las pruebas.
- El `AnalyserNode` se usa para el espectro en pantalla; la decodificación lee las muestras
  directas y mide cada tono con el algoritmo de Goertzel.
- La cabecera lleva el modo, así el receptor no tiene que elegirlo. La velocidad sí debe
  coincidir en ambos lados, como en cualquier enlace serie.
