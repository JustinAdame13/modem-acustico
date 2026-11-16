// ============================================================
//  config.js — Parámetros del módem acústico
//  Todo lo que se puede "afinar" está aquí, en un solo lugar.
// ============================================================

const CONFIG = {
  // Modulación FSK. Cada banda es un juego de tres tonos (Hz):
  //   cero = bit 0, uno = bit 1 (también el reposo de la línea), preambulo = "aquí empieza".
  //   testigos = frecuencias sin tono, donde se mide el ruido de fondo en full dúplex
//              (lejos de los tonos y de los armónicos de la otra banda).
  bandas: {
    normal: { cero: 1500, uno: 2500, preambulo: 3500 },
    // Full dúplex: cada dispositivo transmite en su propia banda (multiplexación por frecuencia)
    A: { cero: 1300, uno: 1700, preambulo: 2100, testigos: [1500, 1900, 2400, 2600] },
    B: { cero: 3000, uno: 3600, preambulo: 4400, testigos: [4700, 4850, 5400, 5550] },
  },

  // Tonos de respuesta del ARQ
  respuesta: { ack: 4000, nack: 5000 },

  // Transmisión en paralelo: 8 canales, uno por bit. Cada canal es un par de tonos
  // (el primero para el 0 y el segundo para el 1) y los 8 suenan al mismo tiempo.
  paralelo: [
    [1000, 1250], [1500, 1750], [2000, 2250], [2500, 2750],
    [3000, 3250], [3500, 3750], [4000, 4250], [4500, 4750],
  ],

  duracionBitMs: 100,     // 100 ms por bit = 10 baudios (se cambia desde la página)
  preambuloMs: 300,       // duración del tono de preámbulo
  bitsDeReposo: 2,        // bits en "1" entre el preámbulo y el primer carácter
  tonoRespuestaMs: 300,   // duración del tono de ACK / NACK
  lecturasPorBit: 8,      // cuántas veces se mide la energía dentro de cada bit
  volumen: 0.85,
  pausaEntreTramasMs: 250,

  // ARQ
  arq: {
    ventana: 4,                     // tramas por ventana en Retroceda N y Rechazo selectivo
    esperaRespuestaMs: 2000,        // temporizador del emisor (hasta que empiece a sonar la respuesta)
    maxFallas: 4,                   // rondas seguidas sin avance antes de abortar
    pausaAntesDeResponderMs: 250,   // el receptor espera a que el canal quede libre
  },

  // Polinomio generador del CRC-16 (CCITT): x^16 + x^12 + x^5 + 1
  generadorCRC: [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],

  maxTramas: 15,                  // el número de trama viaja en 4 bits
  maxBytesPorTrama: 16,           // la longitud viaja en 4 bits (1 a 16)
  maxBytesMensaje: 120,

  // Texto fijo de las series de medición. Emisor y receptor lo conocen,
  // así el receptor puede contar exactamente cuántos bits llegaron mal.
  textoDePrueba: 'Prueba ITL 2026!',
};

// Los cuatro modos de control de errores (viajan en la cabecera de la trama).
const MODOS = [
  { id: 0, nombre: 'Sin protección', detalle: 'Se muestra lo que llegue, con todo y errores.' },
  { id: 1, nombre: 'Paridad + CRC', detalle: 'Detecta errores y avisa "mensaje dañado".' },
  { id: 2, nombre: 'CRC + ARQ', detalle: 'Detecta errores y pide retransmisión con ACK / NACK.' },
  { id: 3, nombre: 'Hamming', detalle: 'Corrige un bit erróneo por grupo sin retransmitir.' },
];

// Variantes del ARQ (tema 2.5). Pare y espere es una ventana de una sola trama.
const VARIANTES_ARQ = [
  { id: 0, nombre: 'Pare y espere', ventana: 1, detalle: 'Una trama, una respuesta.' },
  { id: 1, nombre: 'Retroceda N', ventana: 4, detalle: 'Si falla la trama x, se reenvía desde x.' },
  { id: 2, nombre: 'Rechazo selectivo', ventana: 4, detalle: 'Solo se reenvían las tramas dañadas.' },
];
