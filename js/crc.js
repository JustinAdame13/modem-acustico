// ============================================================
//  crc.js — Verificación de Redundancia Cíclica (tema 2.4.3)
//  Es el mismo procedimiento de las diapositivas:
//    1. Al mensaje se le añaden tantos ceros como grado tenga el generador.
//    2. Se divide entre el polinomio generador usando XOR.
//    3. El residuo son los bits de control que se envían junto al mensaje.
// ============================================================

// Devuelve el residuo de dividir (mensaje + ceros) entre el generador.
// Ambos son arreglos de bits, por ejemplo [1,0,1,0] y [1,1,0,1].
function residuoCRC(bitsMensaje, generador) {
  const grado = generador.length - 1;
  const dividendo = bitsMensaje.concat(new Array(grado).fill(0));

  for (let i = 0; i < bitsMensaje.length; i++) {
    if (dividendo[i] === 1) {
      // "Restar" el generador en esta posición (en binario, restar = XOR)
      for (let j = 0; j < generador.length; j++) {
        dividendo[i + j] ^= generador[j];
      }
    }
  }
  return dividendo.slice(-grado);
}

// Convierte un byte (0-255) en sus 8 bits, del más significativo al menos.
function byteABits(byte) {
  const bits = [];
  for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1);
  return bits;
}

// Convierte un arreglo de bits en un número.
function bitsANumero(bits) {
  let n = 0;
  for (const b of bits) n = n * 2 + b;
  return n;
}

// CRC-16 de una lista de bytes. Devuelve un número de 16 bits.
function calcularCRC16(bytes) {
  let bits = [];
  for (const byte of bytes) bits = bits.concat(byteABits(byte));
  return bitsANumero(residuoCRC(bits, CONFIG.generadorCRC));
}
