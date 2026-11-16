// ============================================================
//  config.js — Parámetros del módem acústico
//  Todo lo que se puede "afinar" está aquí, en un solo lugar.
// ============================================================

const CONFIG = {
  // Modulación FSK: cada símbolo es un tono de una frecuencia distinta (Hz).
  frecuencias: {
    cero: 1500,       // bit 0
    uno: 2500,        // bit 1 (también es el estado de "reposo" de la línea)
    preambulo: 3500,  // "aquí empieza un mensaje"
    ack: 4000,        // confirmación (ARQ)
    nack: 5000,       // recepción errónea (ARQ)
  },

  duracionBitMs: 100,     // 100 ms por bit = 10 baudios (se cambia desde la página)
  preambuloMs: 300,       // duración del tono de preámbulo
  bitsDeReposo: 2,        // bits en "1" entre el preámbulo y el primer carácter
  tonoRespuestaMs: 300,   // duración del tono de ACK / NACK
  lecturasPorBit: 8,      // cuántas veces se mide la energía dentro de cada bit
  volumen: 0.85,

  // ARQ pare y espere
  arq: {
    esperaRespuestaMs: 2500,        // temporizador del emisor
    maxIntentos: 4,                 // después de esto se aborta la comunicación
    pausaAntesDeResponderMs: 250,   // el receptor espera a que el canal quede libre
  },

  // Polinomio generador del CRC-16 (CCITT): x^16 + x^12 + x^5 + 1
  generadorCRC: [1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],

  maxBytesMensaje: 120,
};

// Los cuatro modos de control de errores (viajan en la cabecera de la trama).
const MODOS = [
  { id: 0, nombre: 'Sin protección', detalle: 'Se muestra lo que llegue, con todo y errores.' },
  { id: 1, nombre: 'Paridad + CRC', detalle: 'Detecta errores y avisa "mensaje dañado".' },
  { id: 2, nombre: 'CRC + ARQ', detalle: 'Detecta errores y pide retransmisión con ACK / NACK.' },
  { id: 3, nombre: 'Hamming', detalle: 'Corrige un bit erróneo por grupo sin retransmitir.' },
];
