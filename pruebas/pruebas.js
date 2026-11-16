// Pruebas automáticas de la lógica del módem (sin navegador).
// Ejecutar:  node pruebas/pruebas.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const archivos = ['config', 'crc', 'hamming', 'trama', 'modulador', 'demodulador'];
let codigo = archivos.map((a) => fs.readFileSync(path.join(__dirname, '..', 'js', a + '.js'), 'utf8')).join('\n');
codigo += '\n;({CONFIG, residuoCRC, calcularCRC16, hammingCodificar, hammingDecodificar, construirTrama,' +
  ' textoABytes, ReceptorDeTrama, ranurasDeTrama, tonosDeTrama, tonosDeRespuesta, sintetizar, Demodulador, cargaDeByte})';
const M = vm.runInThisContext(codigo);

let fallas = 0;
function comprobar(nombre, condicion) {
  console.log((condicion ? '  ok    ' : '  FALLA ') + nombre);
  if (!condicion) fallas++;
}

// Generador de números aleatorios repetible
let semilla = 12345;
function azar() { semilla = (semilla * 1664525 + 1013904223) >>> 0; return semilla / 4294967296; }
function ruidoGauss() { return Math.sqrt(-2 * Math.log(azar() + 1e-12)) * Math.cos(2 * Math.PI * azar()); }

const BASE = { modo: 1, paralelo: false, entrelazado: false, variante: 0, id: 0, num: 0, total: 1, pideRespuesta: false };

// Pasa una trama por el receptor sin audio. voltear = lista de [elemento, posición].
function recibirSinAudio(trama, voltear = []) {
  const valores = trama.elementos.map((el) => el.bits.map((b) => b.v));
  for (const [e, p] of voltear) valores[e][p] ^= 1;
  const r = new M.ReceptorDeTrama();
  let e = 0;
  while (!r.terminado) r.recibir(valores[e++]);
  return r.resultado();
}

// Posiciones (en orden de tiempo) de los bits de carga del cuerpo
function bitsDelCuerpo(trama) {
  const lista = [];
  trama.elementos.forEach((el, e) => {
    if (el.seccion === 'cabecera') return;
    el.bits.forEach((b, p) => { if (!['arranque', 'parada', 'relleno'].includes(b.tipo)) lista.push([e, p]); });
  });
  return lista;
}

// Canal de audio simulado: atenuación + ruido blanco (+ otra señal opcional), entregado en bloques
function porElAire(muestras, fsHz, opciones) {
  const { ganancia = 1, ruido = 0, duracionBitMs = 100, banda = 'normal', duplex = false, otra = null, gananciaOtra = 1, rafaga = null } = opciones;
  const eventos = [];
  const d = new M.Demodulador(fsHz, (nombre, datos) => eventos.push({ nombre, datos }));
  d.fijarVelocidad(duracionBitMs);
  d.fijarBanda(banda, duplex);
  const antes = Math.round(fsHz * (0.3 + azar() * 0.2));
  const largo = Math.max(muestras.length, otra ? otra.length : 0);
  const senal = new Float32Array(antes + largo + Math.round(fsHz * 1.5));
  for (let i = 0; i < muestras.length; i++) senal[antes + i] = muestras[i] * ganancia;
  if (otra) for (let i = 0; i < otra.length; i++) senal[antes + i] += otra[i] * gananciaOtra;
  for (let i = 0; i < senal.length; i++) senal[i] += ruido * ruidoGauss();
  if (rafaga) {
    const inicio = antes + Math.round(fsHz * rafaga.segundo);
    for (let i = 0; i < fsHz * rafaga.duracion; i++) senal[inicio + i] += rafaga.fuerza * ruidoGauss();
  }
  for (let i = 0; i < senal.length; i += 512) d.alimentar(senal.subarray(i, Math.min(i + 512, senal.length)));
  return eventos;
}

function audioDeTrama(trama, fsHz, ms, banda = 'normal') {
  return M.sintetizar(M.tonosDeTrama(M.ranurasDeTrama(trama), ms, banda), fsHz, 0.85);
}

console.log('CRC (ejemplos de las diapositivas)');
comprobar('1010 entre 1101 da residuo 001', M.residuoCRC([1, 0, 1, 0], [1, 1, 0, 1]).join('') === '001');
comprobar('1001 entre 1011 da residuo 110', M.residuoCRC([1, 0, 0, 1], [1, 0, 1, 1]).join('') === '110');
comprobar('CRC-16 de "123456789" = 0x31C3', M.calcularCRC16([49, 50, 51, 52, 53, 54, 55, 56, 57]) === 0x31c3);

console.log('Hamming (ejemplo de las diapositivas)');
comprobar('1101 se codifica como 1100110', M.hammingCodificar([1, 1, 0, 1]).join('') === '1100110');
const h = M.hammingDecodificar([1, 1, 0, 0, 0, 1, 0]);
comprobar('1100010 -> error en la posición 3, datos 1101', h.posicionError === 3 && h.datos.join('') === '1101');
let todos = true;
for (let n = 0; n < 16; n++) {
  const datos = [(n >> 3) & 1, (n >> 2) & 1, (n >> 1) & 1, n & 1];
  for (let p = 0; p < 7; p++) {
    const c = M.hammingCodificar(datos); c[p] ^= 1;
    if (M.hammingDecodificar(c).datos.join('') !== datos.join('')) todos = false;
  }
}
comprobar('corrige cualquier error de 1 bit en los 16 grupos', todos);

console.log('Trama (sin audio)');
const bytes = M.textoABytes('Hola señal!');
let idaYVuelta = true;
for (const modo of [0, 1, 2, 3]) {
  for (const paralelo of [false, true]) {
    for (const entrelazado of modo === 3 ? [false, true] : [false]) {
      const p = { ...BASE, modo, paralelo, entrelazado, num: 2, total: 5, id: 1,
        variante: modo === 2 ? 2 : 0, pideRespuesta: modo === 2 };
      const r = recibirSinAudio(M.construirTrama(p, bytes));
      const q = r.params;
      if (!(r.valido && r.texto === 'Hola señal!' && q.modo === modo && q.paralelo === paralelo &&
        q.entrelazado === entrelazado && q.num === 2 && q.total === 5 && q.id === 1)) {
        idaYVuelta = false; console.log('     falló', modo, paralelo, entrelazado);
      }
    }
  }
}
comprobar('ida y vuelta en los 4 modos, serie y paralelo, con y sin entrelazado', idaYVuelta);
{
  const t = M.construirTrama(BASE, M.textoABytes('Hola'));
  const r = recibirSinAudio(t, [[3, 4]]);
  comprobar('paridad: un bit volteado se detecta (paridad y CRC)', !r.valido && r.erroresDeParidad === 1 && r.crcOk === false);
  const r2 = recibirSinAudio(t, [[3, 4], [3, 6]]);
  comprobar('paridad: dos bits en un carácter engañan a la paridad pero no al CRC', r2.erroresDeParidad === 0 && r2.crcOk === false);
  const r3 = recibirSinAudio(t, [[0, 3]]);
  comprobar('cabecera con un bit dañado se corrige', r3.valido);
  const t4 = M.construirTrama({ ...BASE, modo: 3 }, M.textoABytes('Hola'));
  const r4 = recibirSinAudio(t4, [[3, 2], [4, 10]]);
  comprobar('Hamming corrige un bit por grupo', r4.valido && r4.bitsCorregidos === 2 && r4.marcas.filter((m) => m.estado === 'corregido').length === 2);
}
{
  // Ráfaga: 5 bits seguidos en el aire
  const rafaga = (entrelazado, paralelo) => {
    const t = M.construirTrama({ ...BASE, modo: 3, entrelazado, paralelo }, M.textoABytes('Telecom U2'));
    const lista = bitsDelCuerpo(t);
    return recibirSinAudio(t, lista.slice(20, 25));
  };
  const sin = rafaga(false, false), con = rafaga(true, false);
  comprobar('ráfaga de 5 bits sin entrelazado: Hamming no alcanza', !sin.valido);
  comprobar('ráfaga de 5 bits con entrelazado: se corrigen los 5', con.valido && con.bitsCorregidos === 5);
  const conP = rafaga(true, true);
  comprobar('ráfaga de 5 bits en paralelo con entrelazado: se corrige', conP.valido && conP.bitsCorregidos === 5);
}
{
  const t = M.construirTrama({ ...BASE, modo: 1, paralelo: true }, M.textoABytes('ABC'));
  comprobar('paralelo: 3 bytes con paridad + CRC = 5 x 9 bits = 6 símbolos', t.elementos.length === 3 + 6);
}

console.log('Audio simulado (modulador -> canal -> demodulador)');
for (const fsHz of [48000, 44100]) {
  for (const ms of [100, 50, 25]) {
    for (const [modo, paralelo, entrelazado] of [[1, false, false], [3, false, true], [1, true, false], [3, true, true]]) {
      const t = M.construirTrama({ ...BASE, modo, paralelo, entrelazado, num: 1, total: 3 }, M.textoABytes('Hola ITL ñ'));
      const ev = porElAire(audioDeTrama(t, fsHz, ms), fsHz, { ganancia: 0.05, ruido: 0.02, duracionBitMs: ms });
      const trama = ev.find((e) => e.nombre === 'trama');
      comprobar(fsHz + ' Hz, ' + ms + ' ms/bit, modo ' + modo + (paralelo ? ' paralelo' : ' serie') + (entrelazado ? ' entrelazado' : '') +
        (trama ? ' (S/N ' + Math.round(trama.datos.snrDb) + ' dB)' : ''),
        !!trama && trama.datos.valido && trama.datos.texto === 'Hola ITL ñ' && trama.datos.params.num === 1);
    }
  }
}
{
  for (const [tipo, byte] of [['ack', 0x30], ['nack', 0x1d]]) {
    const ev = porElAire(M.sintetizar(M.tonosDeRespuesta(tipo, byte, 50), 48000, 0.85), 48000, { ganancia: 0.05, ruido: 0.01, duracionBitMs: 50 });
    const r = ev.filter((e) => e.nombre === 'respuesta');
    comprobar('respuesta ' + tipo.toUpperCase() + ' con número y mapa', r.length === 1 && r[0].datos.tipo === tipo && r[0].datos.byte === byte);
  }
  const ruidoSolo = porElAire(new Float32Array(48000 * 3), 48000, { ruido: 0.1 });
  comprobar('solo ruido: no inventa tramas', ruidoSolo.length === 0);
  const t = M.construirTrama(BASE, M.textoABytes('Mensaje cortado'));
  const audio = audioDeTrama(t, 48000, 50).subarray(0, 48000 * 2);
  const ev3 = porElAire(audio, 48000, { ganancia: 0.1, ruido: 0.005, duracionBitMs: 50 });
  const tr = ev3.find((e) => e.nombre === 'trama');
  comprobar('señal cortada: aborta y marca la trama como dañada', !!tr && !tr.datos.valido && !!tr.datos.aborto);
}

console.log('Full dúplex (dos dispositivos transmitiendo al mismo tiempo)');
for (const ms of [100, 50, 25]) {
  const deA = M.construirTrama({ ...BASE, modo: 3 }, M.textoABytes('Mensaje de A'));
  const deB = M.construirTrama({ ...BASE, modo: 3 }, M.textoABytes('Respuesta de B!'));
  const audioA = audioDeTrama(deA, 48000, ms, 'A');
  const audioB = audioDeTrama(deB, 48000, ms, 'B');
  // A escucha la banda B mientras su propia bocina suena 20 veces más fuerte
  const enA = porElAire(audioB, 48000, { ganancia: 0.05, otra: audioA, gananciaOtra: 1, ruido: 0.005, duracionBitMs: ms, banda: 'B', duplex: true });
  const enB = porElAire(audioA, 48000, { ganancia: 0.05, otra: audioB, gananciaOtra: 1, ruido: 0.005, duracionBitMs: ms, banda: 'A', duplex: true });
  const ta = enA.find((e) => e.nombre === 'trama'), tb = enB.find((e) => e.nombre === 'trama');
  comprobar(ms + ' ms/bit: A recibe a B mientras transmite', !!ta && ta.datos.valido && ta.datos.texto === 'Respuesta de B!');
  comprobar(ms + ' ms/bit: B recibe a A mientras transmite', !!tb && tb.datos.valido && tb.datos.texto === 'Mensaje de A');
}

console.log('Ruido de impulso por el aire (golpe de 150 ms a media trama)');
{
  let sin = 0, con = 0;
  for (let i = 0; i < 10; i++) {
    for (const entrelazado of [false, true]) {
      const t = M.construirTrama({ ...BASE, modo: 3, entrelazado }, M.textoABytes('Prueba ITL 2026!'));
      const ev = porElAire(audioDeTrama(t, 48000, 25), 48000, { ganancia: 0.05, ruido: 0.003, duracionBitMs: 25,
        rafaga: { segundo: 2 + azar() * 4, duracion: 0.15, fuerza: 0.6 } });
      const tr = ev.find((e) => e.nombre === 'trama');
      if (tr && tr.datos.valido) { if (entrelazado) con++; else sin++; }
    }
  }
  console.log('  info  llegaron bien ' + sin + '/10 sin entrelazado y ' + con + '/10 con entrelazado');
  comprobar('el entrelazado rescata más tramas que sin entrelazar', con > sin);
}

console.log(fallas === 0 ? '\nTodas las pruebas pasaron.' : '\nPruebas con falla: ' + fallas);
process.exit(fallas === 0 ? 0 : 1);
