// ============================================================
//  trama.js — Armado y lectura de la trama (capa de enlace)
//
//  Mensaje completo:
//     PREÁMBULO | CABECERA (control, longitud) | DATOS | CRC
//
//  Transmisión asíncrona: cada carácter viaja delimitado por un bit
//  de arranque (0) y un bit de parada (1). Hay tres formatos:
//     simple   : arranque + 8 datos + parada                (10 bits)
//     paridad  : arranque + 8 datos + paridad par + parada  (11 bits)
//     hamming  : arranque + 7 bits + 7 bits + parada        (16 bits)
//
//  La cabecera SIEMPRE va en formato Hamming: si se daña, el receptor
//  no sabría ni el modo ni cuántos caracteres leer.
// ============================================================

const BITS_POR_FORMATO = { simple: 10, paridad: 11, hamming: 16 };

function formatoDeDatos(modo) {
  if (modo === 0) return 'simple';
  if (modo === 3) return 'hamming';
  return 'paridad';
}

// Qué papel juega cada bit dentro de un carácter (sirve para colorearlos).
function tiposDeFormato(formato) {
  const datos8 = new Array(8).fill('dato');
  const grupo = ['dato', 'dato', 'dato', 'control', 'dato', 'control', 'control'];
  if (formato === 'simple') return ['arranque', ...datos8, 'parada'];
  if (formato === 'paridad') return ['arranque', ...datos8, 'paridad', 'parada'];
  return ['arranque', ...grupo, ...grupo, 'parada'];
}

// Paridad par (VRC): el bit de paridad hace que el total de unos sea par.
function bitDeParidad(bits) {
  let unos = 0;
  for (const b of bits) unos += b;
  return unos % 2;
}

// ---------- EMISOR ----------

// Convierte un byte en la lista de bits que se transmiten para ese carácter.
function codificarCaracter(byte, formato) {
  const datos = byteABits(byte);
  let valores;
  if (formato === 'simple') {
    valores = [0, ...datos, 1];
  } else if (formato === 'paridad') {
    valores = [0, ...datos, bitDeParidad(datos), 1];
  } else {
    const alto = hammingCodificar(datos.slice(0, 4));
    const bajo = hammingCodificar(datos.slice(4, 8));
    valores = [0, ...alto, ...bajo, 1];
  }
  const tipos = tiposDeFormato(formato);
  return valores.map((v, i) => ({ v, tipo: tipos[i], estado: 'ok' }));
}

// Byte de control: 4 bits de información y sus 4 bits invertidos como comprobación.
function byteDeControl(modo, secuencia) {
  const info = (modo & 3) | ((secuencia & 1) << 2);
  return ((~info & 0x0f) << 4) | info;
}

function textoABytes(texto) {
  return Array.from(new TextEncoder().encode(texto));
}

function bytesATexto(bytes) {
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

// Arma la trama completa de un mensaje.
function construirTrama(texto, modo, secuencia) {
  const bytes = textoABytes(texto);
  const longitud = bytes.length;
  const formato = formatoDeDatos(modo);
  const caracteres = [];

  const agregar = (seccion, byte, fmt) =>
    caracteres.push({ seccion, formato: fmt, byte, bits: codificarCaracter(byte, fmt) });

  agregar('cabecera', byteDeControl(modo, secuencia), 'hamming');
  agregar('cabecera', longitud, 'hamming');
  for (const byte of bytes) agregar('datos', byte, formato);

  let crc = null;
  if (modo !== 0) {
    crc = calcularCRC16([longitud, ...bytes]);
    agregar('crc', crc >> 8, formato);
    agregar('crc', crc & 0xff, formato);
  }
  return { texto, modo, secuencia, bytes, crc, caracteres };
}

// Todos los bits de la trama, en el orden en que salen por la bocina.
function valoresDeTrama(trama) {
  const valores = [];
  for (const c of trama.caracteres) for (const b of c.bits) valores.push(b.v);
  return valores;
}

// ---------- RECEPTOR ----------

// Interpreta los bits recibidos de un carácter.
function decodificarCaracter(valores, formato) {
  const tipos = tiposDeFormato(formato);
  const bits = valores.map((v, i) => ({ v, tipo: tipos[i], estado: 'ok' }));
  const ultimo = valores.length - 1;
  let paridadOk = true;
  let corregidos = 0;
  let datos;

  // Bit de arranque = 0 y bit de parada = 1; si no, hay error de formato.
  const formatoOk = valores[0] === 0 && valores[ultimo] === 1;
  if (valores[0] !== 0) bits[0].estado = 'error';
  if (valores[ultimo] !== 1) bits[ultimo].estado = 'error';

  if (formato === 'simple') {
    datos = valores.slice(1, 9);
  } else if (formato === 'paridad') {
    datos = valores.slice(1, 9);
    paridadOk = bitDeParidad(datos) === valores[9];
    if (!paridadOk) bits[9].estado = 'error';
  } else {
    datos = [];
    for (const inicio of [1, 8]) {
      const r = hammingDecodificar(valores.slice(inicio, inicio + 7));
      datos = datos.concat(r.datos);
      if (r.posicionError !== 0) {
        corregidos++;
        bits[inicio + 7 - r.posicionError].estado = 'corregido';
      }
    }
  }
  return { formato, bits, byte: bitsANumero(datos), paridadOk, formatoOk, corregidos };
}

// Va recibiendo caracteres uno por uno y sabe qué toca después:
// primero la cabecera, luego los datos y al final el CRC.
class ReceptorDeTrama {
  constructor() {
    this.caracteres = [];
    this.cabecera = [];
    this.bytes = [];
    this.crcBytes = [];
    this.modo = null;
    this.secuencia = 0;
    this.longitud = 0;
    this.cabeceraOk = null;
    this.terminado = false;
  }

  // Describe el carácter que se espera a continuación (o null si ya acabó).
  siguiente() {
    if (this.terminado) return null;
    let seccion, formato;
    if (this.cabecera.length < 2) {
      seccion = 'cabecera'; formato = 'hamming';
    } else if (this.bytes.length < this.longitud) {
      seccion = 'datos'; formato = formatoDeDatos(this.modo);
    } else {
      seccion = 'crc'; formato = formatoDeDatos(this.modo);
    }
    return { seccion, formato, nbits: BITS_POR_FORMATO[formato], tipos: tiposDeFormato(formato) };
  }

  // Recibe los bits de un carácter completo.
  recibir(valores) {
    const esperado = this.siguiente();
    const c = decodificarCaracter(valores, esperado.formato);
    c.seccion = esperado.seccion;
    c.valoresCrudos = valores.slice();
    this.caracteres.push(c);

    if (c.seccion === 'cabecera') {
      this.cabecera.push(c.byte);
      if (this.cabecera.length === 2) this.leerCabecera();
    } else if (c.seccion === 'datos') {
      this.bytes.push(c.byte);
      if (this.modo === 0 && this.bytes.length === this.longitud) this.terminado = true;
    } else {
      this.crcBytes.push(c.byte);
      if (this.crcBytes.length === 2) this.terminado = true;
    }
    return c;
  }

  leerCabecera() {
    const [control, longitud] = this.cabecera;
    const info = control & 0x0f;
    const comprobacion = (control >> 4) & 0x0f;
    this.cabeceraOk = comprobacion === (~info & 0x0f) && longitud > 0
      && longitud <= CONFIG.maxBytesMensaje && (info & 8) === 0;
    if (!this.cabeceraOk) { this.terminado = true; return; }
    this.modo = info & 3;
    this.secuencia = (info >> 2) & 1;
    this.longitud = longitud;
  }

  // Resumen de la trama recibida y veredicto de la verificación.
  resultado() {
    const r = {
      cabeceraOk: this.cabeceraOk === true,
      modo: this.modo, secuencia: this.secuencia, longitud: this.longitud,
      bytes: this.bytes, texto: '', caracteres: this.caracteres,
      erroresDeParidad: 0, erroresDeFormato: 0, bitsCorregidos: 0,
      crcRecibido: null, crcCalculado: null, crcOk: null,
      completa: this.terminado, valido: false,
    };
    for (const c of this.caracteres) {
      if (!c.paridadOk) r.erroresDeParidad++;
      if (!c.formatoOk) r.erroresDeFormato++;
      r.bitsCorregidos += c.corregidos;
    }
    if (!r.cabeceraOk) return r;

    r.texto = bytesATexto(this.bytes);
    if (this.modo !== 0 && this.crcBytes.length === 2) {
      // El receptor recalcula el CRC y lo compara con el que llegó.
      r.crcRecibido = (this.crcBytes[0] << 8) | this.crcBytes[1];
      r.crcCalculado = calcularCRC16([this.longitud, ...this.bytes]);
      r.crcOk = r.crcRecibido === r.crcCalculado;
    }
    if (this.modo === 0) r.valido = r.completa;              // no se verifica nada
    else if (this.modo === 3) r.valido = r.crcOk === true;
    else r.valido = r.crcOk === true && r.erroresDeParidad === 0;
    return r;
  }
}
