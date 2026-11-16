// ============================================================
//  trama.js — Armado y lectura de la trama (capa de enlace)
//
//  Una trama:
//     PREÁMBULO | CABECERA (3 caracteres) | CUERPO: DATOS + CRC
//
//  Cabecera (siempre en serie y con Hamming, para que sea robusta):
//     C0  control: modo (2 bits), paralelo (1), entrelazado (1) y los mismos 4 bits invertidos
//     C1  número de trama (4 bits) y total de tramas - 1 (4 bits)
//     C2  variante ARQ (2), id de mensaje (1), pide respuesta (1), longitud - 1 (4)
//
//  Cada carácter en serie es asíncrono: bit de arranque (0), carga y bit de parada (1).
//  La "carga" de un byte depende del modo:
//     simple  : 8 bits de datos                     (Sin protección)
//     paridad : 8 bits de datos + 1 de paridad par  (Paridad + CRC y CRC + ARQ)
//     hamming : dos grupos de 7 bits                (Hamming)
//
//  El cuerpo puede viajar en serie (un bit tras otro) o en paralelo (8 bits por símbolo).
//  Con entrelazado, los bits se reordenan para que una ráfaga de ruido quede repartida.
// ============================================================

const BITS_DE_CARGA = { simple: 8, paridad: 9, hamming: 14 };
const GRUPO_HAMMING = ['dato', 'dato', 'dato', 'control', 'dato', 'control', 'control'];

function formatoDeDatos(modo) {
  if (modo === 0) return 'simple';
  if (modo === 3) return 'hamming';
  return 'paridad';
}

// Qué papel juega cada bit de la carga (sirve para colorearlos).
function tiposDeCarga(formato) {
  const datos8 = new Array(8).fill('dato');
  if (formato === 'simple') return datos8;
  if (formato === 'paridad') return [...datos8, 'paridad'];
  return [...GRUPO_HAMMING, ...GRUPO_HAMMING];
}

// Paridad par (VRC): el bit de paridad hace que el total de unos sea par.
function bitDeParidad(bits) {
  let unos = 0;
  for (const b of bits) unos += b;
  return unos % 2;
}

// ---------- Carga de un byte ----------

function cargaDeByte(byte, formato) {
  const datos = byteABits(byte);
  if (formato === 'simple') return datos;
  if (formato === 'paridad') return [...datos, bitDeParidad(datos)];
  return [...hammingCodificar(datos.slice(0, 4)), ...hammingCodificar(datos.slice(4, 8))];
}

// Lee la carga recibida. "corregidas" son las posiciones (dentro de la carga)
// que Hamming invirtió; "errorParidad" la posición del bit de paridad si falló.
function leerCarga(carga, formato) {
  if (formato === 'simple') return { byte: bitsANumero(carga), paridadOk: true, corregidas: [] };
  if (formato === 'paridad') {
    const datos = carga.slice(0, 8);
    return { byte: bitsANumero(datos), paridadOk: bitDeParidad(datos) === carga[8], corregidas: [] };
  }
  const alto = hammingDecodificar(carga.slice(0, 7));
  const bajo = hammingDecodificar(carga.slice(7, 14));
  const corregidas = [];
  if (alto.posicionError) corregidas.push(7 - alto.posicionError);
  if (bajo.posicionError) corregidas.push(7 + 7 - bajo.posicionError);
  return { byte: bitsANumero([...alto.datos, ...bajo.datos]), paridadOk: true, corregidas };
}

// ---------- Cabecera ----------

function bytesDeCabecera(p) {
  const info = (p.modo & 3) | (p.paralelo ? 4 : 0) | (p.entrelazado ? 8 : 0);
  return [
    ((~info & 0x0f) << 4) | info,
    ((p.num & 0x0f) << 4) | ((p.total - 1) & 0x0f),
    ((p.variante & 3) << 6) | ((p.id & 1) << 5) | (p.pideRespuesta ? 16 : 0) | ((p.longitud - 1) & 0x0f),
  ];
}

// Devuelve los parámetros de la trama, o null si la cabecera no tiene sentido.
function leerCabecera([c0, c1, c2]) {
  const info = c0 & 0x0f;
  if ((c0 >> 4) !== (~info & 0x0f)) return null;
  const p = {
    modo: info & 3,
    paralelo: (info & 4) !== 0,
    entrelazado: (info & 8) !== 0,
    num: c1 >> 4,
    total: (c1 & 0x0f) + 1,
    variante: c2 >> 6,
    id: (c2 >> 5) & 1,
    pideRespuesta: (c2 & 16) !== 0,
    longitud: (c2 & 0x0f) + 1,
  };
  if (p.num >= p.total || p.variante === 3) return null;
  if (p.entrelazado && p.modo !== 3) return null;
  if (p.modo !== 2 && (p.variante !== 0 || p.pideRespuesta)) return null;
  return p;
}

// ---------- Cómo viaja el cuerpo ----------

// Describe el cuerpo (datos + CRC): qué bits van en cada carácter o símbolo.
// Los bits "lógicos" son las cargas de todos los bytes, una tras otra.
// "indices" dice qué bit lógico va en cada posición del aire.
function planDelCuerpo(p) {
  const formato = formatoDeDatos(p.modo);
  const porCaracter = BITS_DE_CARGA[formato];
  const nCaracteres = p.longitud + (p.modo === 0 ? 0 : 2);
  const total = nCaracteres * porCaracter;
  const entrelazar = p.entrelazado && formato === 'hamming';

  const tiposLogicos = [];
  for (let c = 0; c < nCaracteres; c++) tiposLogicos.push(...tiposDeCarga(formato));

  // Entrelazado: los grupos de Hamming forman una matriz (un grupo por columna).
  // Sin entrelazar se transmite columna por columna; entrelazado, renglón por renglón.
  // Así una ráfaga de errores seguidos cae en grupos distintos.
  const orden = [];
  if (entrelazar) {
    const grupos = total / 7;
    for (let renglon = 0; renglon < 7; renglon++) {
      for (let g = 0; g < grupos; g++) orden.push(g * 7 + renglon);
    }
  } else {
    for (let k = 0; k < total; k++) orden.push(k);
  }

  const elementos = [];
  if (!p.paralelo) {
    for (let c = 0; c < nCaracteres; c++) {
      const indices = orden.slice(c * porCaracter, (c + 1) * porCaracter);
      elementos.push({
        tipo: 'caracter',
        seccion: entrelazar ? 'entrelazado' : (c < p.longitud ? 'datos' : 'crc'),
        indices,
        tipos: ['arranque', ...indices.map((i) => tiposLogicos[i]), 'parada'],
      });
    }
  } else {
    for (let desde = 0; desde < total; desde += 8) {
      const indices = orden.slice(desde, desde + 8);
      const tipos = indices.map((i) => tiposLogicos[i]);
      while (tipos.length < 8) tipos.push('relleno');
      elementos.push({ tipo: 'simbolo', seccion: 'paralelo', indices, tipos });
    }
  }
  return { formato, porCaracter, nCaracteres, total, entrelazar, tiposLogicos, elementos };
}

function textoABytes(texto) {
  return Array.from(new TextEncoder().encode(texto));
}

function bytesATexto(bytes) {
  return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}

// ---------- EMISOR ----------

// p = { modo, paralelo, entrelazado, variante, id, num, total, pideRespuesta }
function construirTrama(parametros, bytesDatos) {
  const p = { ...parametros, longitud: bytesDatos.length };
  p.entrelazado = Boolean(p.entrelazado) && p.modo === 3;
  const cabecera = bytesDeCabecera(p);

  const cuerpo = bytesDatos.slice();
  let crc = null;
  if (p.modo !== 0) {
    crc = calcularCRC16([cabecera[1], cabecera[2], ...bytesDatos]);
    cuerpo.push(crc >> 8, crc & 0xff);
  }

  const plan = planDelCuerpo(p);
  const logicos = [];
  for (const b of cuerpo) logicos.push(...cargaDeByte(b, plan.formato));

  const elementos = [];
  const tiposCab = ['arranque', ...tiposDeCarga('hamming'), 'parada'];
  cabecera.forEach((byte, i) => {
    const valores = [0, ...cargaDeByte(byte, 'hamming'), 1];
    elementos.push({ tipo: 'caracter', seccion: 'cabecera', indiceCabecera: i, byte,
      bits: valores.map((v, k) => ({ v, tipo: tiposCab[k] })) });
  });
  plan.elementos.forEach((el, c) => {
    const valores = el.indices.map((i) => logicos[i]);
    if (el.tipo === 'caracter') { valores.unshift(0); valores.push(1); }
    while (valores.length < el.tipos.length) valores.push(0);
    const legible = el.tipo === 'caracter' && !plan.entrelazar;
    elementos.push({ tipo: el.tipo, seccion: el.seccion, byte: legible ? cuerpo[c] : null,
      bits: valores.map((v, k) => ({ v, tipo: el.tipos[k] })) });
  });

  return { ...p, bytes: bytesDatos, crc, cabecera, cuerpo, plan, logicos, elementos };
}

// ---------- RECEPTOR ----------

const TIPOS_CABECERA = ['arranque', ...tiposDeCarga('hamming'), 'parada'];

// Va recibiendo los caracteres y símbolos de una trama y sabe qué toca después.
class ReceptorDeTrama {
  constructor() {
    this.registros = [];       // lo que llegó por el aire, elemento por elemento
    this.cabecera = [];
    this.params = null;
    this.cabeceraOk = null;
    this.plan = null;
    this.logicos = null;       // bits lógicos del cuerpo (ya sin entrelazar)
    this.decodificados = [];   // un resultado por byte del cuerpo
    this.marcas = [];          // bits que hay que marcar en pantalla al final
    this.indiceCuerpo = 0;
    this.terminado = false;
  }

  // Describe lo que se espera a continuación. "ranuras" = cuántos tiempos de bit dura.
  siguiente() {
    if (this.terminado) return null;
    if (this.cabecera.length < 3) {
      return { tipo: 'caracter', seccion: 'cabecera', nbits: 16, ranuras: 16, tipos: TIPOS_CABECERA,
        indiceCabecera: this.cabecera.length };
    }
    const el = this.plan.elementos[this.indiceCuerpo];
    return { tipo: el.tipo, seccion: el.seccion, nbits: el.tipos.length,
      ranuras: el.tipo === 'caracter' ? el.tipos.length : 1, tipos: el.tipos };
  }

  // Recibe los bits de un carácter (con arranque y parada) o de un símbolo (8 bits).
  recibir(valores) {
    const esperado = this.siguiente();
    const r = { tipo: esperado.tipo, seccion: esperado.seccion, valores: valores.slice(),
      estados: valores.map(() => 'ok'), formatoOk: true, paridadOk: true, byte: null,
      indice: this.registros.length, indiceCabecera: esperado.indiceCabecera };

    if (r.tipo === 'caracter') {
      const ultimo = valores.length - 1;
      if (valores[0] !== 0) { r.estados[0] = 'error'; r.formatoOk = false; }
      if (valores[ultimo] !== 1) { r.estados[ultimo] = 'error'; r.formatoOk = false; }
    }
    this.registros.push(r);

    if (r.seccion === 'cabecera') {
      const lectura = leerCarga(valores.slice(1, 15), 'hamming');
      for (const k of lectura.corregidas) r.estados[k + 1] = 'corregido';
      r.byte = lectura.byte;
      this.cabecera.push(lectura.byte);
      if (this.cabecera.length === 3) this.leerCabecera();
      return r;
    }

    // Cuerpo: cada bit recibido va a su lugar lógico
    const el = this.plan.elementos[this.indiceCuerpo];
    const desfase = el.tipo === 'caracter' ? 1 : 0;
    el.indices.forEach((i, k) => { this.logicos[i] = valores[k + desfase]; });

    // En serie y sin entrelazar, cada carácter es un byte: se lee en cuanto llega.
    if (el.tipo === 'caracter' && !this.plan.entrelazar) {
      const d = this.leerByte(this.indiceCuerpo);
      r.byte = d.byte;
      r.paridadOk = d.paridadOk;
    }
    this.indiceCuerpo++;
    if (this.indiceCuerpo === this.plan.elementos.length) this.finalizar();
    return r;
  }

  leerCabecera() {
    this.params = leerCabecera(this.cabecera);
    this.cabeceraOk = this.params !== null;
    if (!this.cabeceraOk) { this.terminado = true; return; }
    this.plan = planDelCuerpo(this.params);
    this.logicos = new Array(this.plan.total).fill(0);

    // Dónde quedó cada bit lógico en el aire: registro y posición
    this.posicionEnAire = [];
    this.plan.elementos.forEach((el, e) => {
      el.indices.forEach((i, k) => {
        this.posicionEnAire[i] = { e: 3 + e, p: k + (el.tipo === 'caracter' ? 1 : 0) };
      });
    });
  }

  // Lee el byte número c del cuerpo y anota en pantalla lo que haya corregido o fallado.
  leerByte(c) {
    if (this.decodificados[c]) return this.decodificados[c];
    const n = this.plan.porCaracter;
    const carga = this.logicos.slice(c * n, (c + 1) * n);
    const d = leerCarga(carga, this.plan.formato);
    d.carga = carga;
    d.corregidasLogicas = d.corregidas.map((k) => c * n + k);
    this.decodificados[c] = d;
    for (const j of d.corregidasLogicas) this.marcar(j, 'corregido');
    if (!d.paridadOk) this.marcar(c * n + 8, 'error');
    return d;
  }

  marcar(indiceLogico, estado) {
    const lugar = this.posicionEnAire[indiceLogico];
    this.registros[lugar.e].estados[lugar.p] = estado;
    this.marcas.push({ ...lugar, estado });
  }

  finalizar() {
    for (let c = 0; c < this.plan.nCaracteres; c++) this.leerByte(c);
    this.terminado = true;
  }

  // Resumen de la trama recibida y veredicto de la verificación.
  resultado() {
    const r = {
      cabeceraOk: this.cabeceraOk === true, params: this.params, completa: this.terminado,
      registros: this.registros, marcas: this.marcas, decodificados: this.decodificados,
      logicos: this.logicos, plan: this.plan, cabecera: this.cabecera,
      bytes: [], texto: '', erroresDeParidad: 0, erroresDeFormato: 0, bitsCorregidos: 0,
      crcRecibido: null, crcCalculado: null, crcOk: null, valido: false,
    };
    for (const reg of this.registros) if (!reg.formatoOk) r.erroresDeFormato++;
    if (!r.cabeceraOk) return r;

    const p = this.params;
    for (const d of this.decodificados) {
      if (!d) continue;
      if (!d.paridadOk) r.erroresDeParidad++;
      r.bitsCorregidos += d.corregidas.length;
    }
    r.bytes = this.decodificados.slice(0, p.longitud).filter(Boolean).map((d) => d.byte);
    r.texto = bytesATexto(r.bytes);

    if (p.modo !== 0 && this.terminado) {
      const crcBytes = this.decodificados.slice(p.longitud, p.longitud + 2).map((d) => d.byte);
      // El receptor recalcula el CRC y lo compara con el que llegó.
      r.crcRecibido = (crcBytes[0] << 8) | crcBytes[1];
      r.crcCalculado = calcularCRC16([this.cabecera[1], this.cabecera[2], ...r.bytes]);
      r.crcOk = r.crcRecibido === r.crcCalculado;
    }
    if (p.modo === 0) r.valido = r.completa;
    else if (p.modo === 3) r.valido = r.crcOk === true;
    else r.valido = r.crcOk === true && r.erroresDeParidad === 0;
    return r;
  }
}

// La respuesta del ARQ es un tono (ACK o NACK) seguido de un carácter con Hamming:
//   4 bits altos = número de trama, 4 bits bajos = mapa de la ventana (rechazo selectivo).
class ReceptorDeRespuesta {
  constructor() { this.terminado = false; this.registro = null; }
  siguiente() {
    if (this.terminado) return null;
    return { tipo: 'caracter', seccion: 'respuesta', nbits: 16, ranuras: 16, tipos: TIPOS_CABECERA };
  }
  recibir(valores) {
    const lectura = leerCarga(valores.slice(1, 15), 'hamming');
    this.registro = { byte: lectura.byte, formatoOk: valores[0] === 0 && valores[15] === 1 };
    this.terminado = true;
    return this.registro;
  }
}
