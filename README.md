# Módem acústico web

Transmite texto entre dispositivos usando solo la bocina y el micrófono.
Proyecto de la unidad 2 de Fundamentos de Telecomunicaciones (ITL).

No usa frameworks ni necesita instalar nada: es HTML, CSS y JavaScript.

## Cómo abrirlo

El micrófono solo funciona en `https://` o en `localhost`.

- **En la laptop:** abre una terminal en esta carpeta, ejecuta `python -m http.server 8000`
  y entra a `http://localhost:8000`.
- **En el celular y para la exposición:** el enlace de Vercel. Cada `git push` lo actualiza.

## Qué tiene

| Función | Dónde se elige | Tema |
|---|---|---|
| Canal por el aire o interno (simulado, con atenuación, ruido y golpe de ruido) | Barra de arriba | Medio no guiado, perturbaciones |
| Half dúplex o full dúplex (cada dispositivo en su banda) | Barra de arriba | Sentidos de transmisión |
| Serie o paralelo (8 tonos a la vez) | Emisor | Modos de transmisión |
| Sin protección, paridad + CRC, CRC + ARQ, Hamming | Emisor | 2.4 y 2.5 |
| Pare y espere, Retroceda N y Rechazo selectivo | Emisor, con CRC + ARQ | 2.5 y 2.5.2 |
| Entrelazado contra ráfagas | Emisor, con Hamming | Ruido de impulso, 2.5.3 |
| Mensajes en varias tramas de 4, 8 o 16 bytes | Emisor | Tramas, ventanas |
| Series de medición con gráficas y CSV | Mediciones | Objetivo 4 |

## Guion para la demostración

Todo esto se puede hacer en una sola laptop con el canal **Interno**; después se repite por el aire.

1. **Serie contra paralelo.** Envía el mismo mensaje en serie y en paralelo. El resumen bajo el
   mensaje dice cuánto tarda cada uno; en «Bits recibidos» la serie llega en renglones y el
   paralelo en columnas de 8 bits.
2. **Detectar.** Paridad + CRC con «Dañar: 1 bit». El receptor dice qué falló y el CRC calculado
   no coincide con el recibido.
3. **ARQ.** CRC + ARQ, mensaje largo (3 o 4 tramas) y «Dañar: 1 bit en la trama 2».
   Repite con las tres variantes y compara el **Diagrama del enlace**:
   - Pare y espere: una respuesta por trama.
   - Retroceda N: se reenvía desde la trama 2; la 3 y la 4 aparecen como *descartadas*.
   - Rechazo selectivo: solo se reenvía la trama 2.
4. **Corregir y entrelazar.** Hamming con «Dañar: 5 bits en ráfaga». Sin entrelazado la trama llega
   dañada; con entrelazado Hamming corrige los 5. La matriz de **Dentro de Hamming** muestra por qué:
   sin entrelazar la ráfaga cae en una columna (un grupo); entrelazado queda repartida en un renglón.
   Por el aire, en lugar de dañar bits, aplaude a media trama.
5. **Full dúplex.** Dos dispositivos por el aire: uno en Banda A y otro en Banda B, los dos con
   «Escuchar» encendido, y envían al mismo tiempo. Cada uno recibe el mensaje del otro.
6. **Mediciones.** Escribe la condición (por ejemplo «1 m, silencio»), envía una serie, cambia la
   distancia o el ruido y envía otra. El receptor cuenta los bits erróneos de cada trama porque
   conoce el texto de prueba. La tabla resume cada condición y «Descargar CSV» exporta todo.

En dos dispositivos la velocidad debe ser la misma en ambos. Lo demás (modo, serie o paralelo,
entrelazado, variante del ARQ) viaja en la cabecera y el receptor lo detecta solo.

## La trama

```
PREÁMBULO     tono de 300 ms
reposo        2 bits en 1
CABECERA      3 caracteres en serie, siempre con Hamming:
                C0  modo, paralelo y entrelazado (y los mismos 4 bits invertidos)
                C1  número de trama y total de tramas
                C2  variante del ARQ, id del mensaje, «pide respuesta» y longitud
CUERPO        datos + CRC-16 (sin CRC en «Sin protección»)
```

En serie, cada carácter es asíncrono: arranque (0), carga y parada (1).
En paralelo, el cuerpo va en símbolos de 8 bits, uno por canal, sin arranque ni parada.

| Carga de cada byte | Bits | Modo |
|---|---|---|
| 8 datos | 8 | Sin protección |
| 8 datos + paridad par | 9 | Paridad + CRC, CRC + ARQ |
| 2 grupos Hamming (7,4) | 14 | Hamming |

La respuesta del ARQ es un tono (ACK 4000 Hz o NACK 5000 Hz) y un carácter con Hamming:
número de la siguiente trama (Pare y espere, Retroceda N) o mapa de la ventana (Rechazo selectivo).

## Frecuencias

| Uso | 0 | 1 | Inicio |
|---|---|---|---|
| Normal | 1500 Hz | 2500 Hz | 3500 Hz |
| Full dúplex, banda A | 1300 Hz | 1700 Hz | 2100 Hz |
| Full dúplex, banda B | 3000 Hz | 3600 Hz | 4400 Hz |
| Paralelo, canal n (1 a 8) | 500·n + 500 Hz | 500·n + 750 Hz | — |

## Archivos, en el orden en que conviene explicarlos

| Archivo | Qué hace |
|---|---|
| `js/config.js` | Frecuencias, tiempos, modos y variantes del ARQ |
| `js/crc.js` | División polinómica con XOR, igual que en las diapositivas |
| `js/hamming.js` | k1, k2, k3 y corrección por posición |
| `js/trama.js` | Cabecera, paridad, cuerpo en serie o paralelo, entrelazado |
| `js/modulador.js` | Bits a tonos (uno o varios a la vez) |
| `js/demodulador.js` | Tonos a bits: Goertzel, votación, sincronía, full dúplex |
| `js/audio.js` | Bocina, micrófono, canal interno y golpe de ruido |
| `js/emisor.js` | Envío, daños a propósito y las tres variantes del ARQ |
| `js/receptor.js` | Verificación, armado del mensaje y respuestas ACK / NACK |
| `js/experimento.js` | Series de medición, gráficas y CSV |
| `js/vista.js`, `js/matriz.js`, `js/diagrama.js` | Espectro, trama bit por bit, matriz de Hamming, diagrama del enlace |
| `js/app.js`, `js/inicio.js` | Estado compartido y conexión de los botones |

## Pruebas automáticas

Con Node instalado: `node pruebas/pruebas.js`. Comprueba los ejemplos de las diapositivas
(CRC de 1010 entre 1101 = 001; Hamming de 1101 = 1100110 y el error en la posición 3), todas las
combinaciones de modo, serie o paralelo y entrelazado, ráfagas, respuestas del ARQ, full dúplex con
los dos dispositivos transmitiendo a la vez y tramas completas por un canal de audio simulado con ruido.
