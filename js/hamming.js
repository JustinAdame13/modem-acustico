// ============================================================
//  hamming.js — Código Hamming de 7 bits (tema 2.5.3)
//  Mismo esquema de las diapositivas. Por cada 4 bits de datos
//  (b4 b3 b2 b1) se calculan 3 constantes de control:
//
//      k1 = b1 XOR b2 XOR b4
//      k2 = b1 XOR b3 XOR b4
//      k3 = b2 XOR b3 XOR b4
//
//  y se envía:   b4  b3  b2  k3  b1  k2  k1
//  posición:      7   6   5   4   3   2   1
// ============================================================

function calcularConstantes(b4, b3, b2, b1) {
  return {
    k1: b1 ^ b2 ^ b4,
    k2: b1 ^ b3 ^ b4,
    k3: b2 ^ b3 ^ b4,
  };
}

// Recibe 4 bits [b4, b3, b2, b1] y devuelve los 7 bits a transmitir.
function hammingCodificar(datos) {
  const [b4, b3, b2, b1] = datos;
  const { k1, k2, k3 } = calcularConstantes(b4, b3, b2, b1);
  return [b4, b3, b2, k3, b1, k2, k1];
}

// Recibe los 7 bits que llegaron. Devuelve los 4 bits de datos ya
// corregidos y la posición (1-7) del bit dañado, o 0 si no hubo error.
function hammingDecodificar(recibido) {
  const bits = recibido.slice();
  const [b4, b3, b2, k3, b1, k2, k1] = bits;

  // El receptor vuelve a calcular las constantes con los datos que llegaron...
  const nuevas = calcularConstantes(b4, b3, b2, b1);

  // ...y las compara con las recibidas usando OR exclusiva.
  // El resultado, leído como número binario (k3 k2 k1), es la posición dañada.
  const posicionError = ((k3 ^ nuevas.k3) << 2) | ((k2 ^ nuevas.k2) << 1) | (k1 ^ nuevas.k1);

  if (posicionError !== 0) {
    const indice = 7 - posicionError;   // la posición 7 es el primer bit del arreglo
    bits[indice] ^= 1;                  // corregir = invertir el bit dañado
  }

  return {
    datos: [bits[0], bits[1], bits[2], bits[4]],  // b4 b3 b2 b1
    posicionError,
  };
}
