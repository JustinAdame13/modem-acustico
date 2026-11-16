// Pruebas automáticas de la lógica del módem (sin navegador).
// Ejecutar:  node pruebas/pruebas.js
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const archivos = ['config', 'crc', 'hamming', 'trama', 'modulador', 'demodulador'];
let codigo = archivos.map((a) => fs.readFileSync(path.join(__dirname, '..', 'js', a + '.js'), 'utf8')).join('\n');
codigo += '\n;({CONFIG, residuoCRC, calcularCRC16, hammingCodificar, hammingDecodificar, construirTrama,' +
  ' valoresDeTrama, ReceptorDeTrama, tonosDeTrama, tonoDeRespuesta, sintetizar, Demodulador})';
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

// Pasa una trama de bits por el receptor sin audio
function recibirBits(valores) {
  const r = new M.ReceptorDeTrama();
  let i = 0;
  while (!r.terminado) { const s = r.siguiente(); r.recibir(valores.slice(i, i + s.nbits)); i += s.nbits; }
  return r.resultado();
}

// Canal de audio simulado: atenuación + ruido blanco, entregado en bloques
function porElAire(muestras, fsHz, opciones) {
  const { ganancia = 1, ruido = 0, duracionBitMs = 100 } = opciones;
  const eventos = [];
  const d = new M.Demodulador(fsHz, (nombre, datos) => eventos.push({ nombre, datos }));
  d.fijarVelocidad(duracionBitMs);
  const antes = Math.round(fsHz * (0.3 + azar() * 0.2));
  const senal = new Float32Array(antes + muestras.length + Math.round(fsHz * 1.5));
  senal.set(muestras, antes);
  for (let i = 0; i < senal.length; i++) senal[i] = senal[i] * ganancia + ruido * ruidoGauss();
  for (let i = 0; i < senal.length; i += 512) d.alimentar(senal.subarray(i, Math.min(i + 512, senal.length)));
  return eventos;
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
const mensaje = 'Hola señal: WiFi-1234!';
for (const modo of [0, 1, 2, 3]) {
  const r = recibirBits(M.valoresDeTrama(M.construirTrama(mensaje, modo, 1)));
  comprobar('modo ' + modo + ' ida y vuelta', r.valido && r.texto === mensaje && r.modo === modo && r.secuencia === 1);
}
{
  const t = M.construirTrama('Hola', 1, 0); const v = M.valoresDeTrama(t); v[32 + 3] ^= 1;
  const r = recibirBits(v);
  comprobar('modo 1: un bit volteado se detecta (paridad y CRC)', !r.valido && r.erroresDeParidad === 1 && r.crcOk === false);
  const v2 = M.valoresDeTrama(t); v2[32 + 3] ^= 1; v2[32 + 5] ^= 1;
  const r2 = recibirBits(v2);
  comprobar('modo 1: dos bits en un carácter engañan a la paridad pero no al CRC', r2.erroresDeParidad === 0 && r2.crcOk === false && !r2.valido);
  const t3 = M.construirTrama('Hola', 3, 0); const v3 = M.valoresDeTrama(t3); v3[32 + 2] ^= 1; v3[32 + 16 + 10] ^= 1;
  const r3 = recibirBits(v3);
  comprobar('modo 3: Hamming corrige un bit por grupo', r3.valido && r3.texto === 'Hola' && r3.bitsCorregidos === 2);
  const v4 = M.valoresDeTrama(t3); v4[32 + 2] ^= 1; v4[32 + 3] ^= 1;
  const r4 = recibirBits(v4);
  comprobar('modo 3: dos errores en un grupo no se corrigen, el CRC lo delata', !r4.valido);
  const v5 = M.valoresDeTrama(t); v5[3] ^= 1;
  comprobar('cabecera con un bit dañado se corrige', recibirBits(v5).valido);
}

console.log('Audio simulado (modulador -> canal -> demodulador)');
for (const fsHz of [48000, 44100]) {
  for (const ms of [100, 50, 25]) {
    for (const modo of [1, 3]) {
      const t = M.construirTrama('Hola ITL ñ', modo, 0);
      const audio = M.sintetizar(M.tonosDeTrama(M.valoresDeTrama(t), ms), fsHz, 0.85);
      const ev = porElAire(audio, fsHz, { ganancia: 0.05, ruido: 0.02, duracionBitMs: ms });
      const trama = ev.find((e) => e.nombre === 'trama');
      comprobar(fsHz + ' Hz, ' + ms + ' ms/bit, modo ' + modo + ' con ruido' +
        (trama ? ' (S/N ' + Math.round(trama.datos.snrDb) + ' dB)' : ''),
        !!trama && trama.datos.valido && trama.datos.texto === 'Hola ITL ñ');
    }
  }
}
{
  const ev = porElAire(M.sintetizar(M.tonoDeRespuesta('ack'), 48000, 0.85), 48000, { ganancia: 0.05, ruido: 0.01 });
  comprobar('detecta ACK', ev.filter((e) => e.nombre === 'respuesta' && e.datos.tipo === 'ack').length === 1);
  const ev2 = porElAire(M.sintetizar(M.tonoDeRespuesta('nack'), 48000, 0.85), 48000, { ganancia: 0.05, ruido: 0.01 });
  comprobar('detecta NACK', ev2.filter((e) => e.nombre === 'respuesta' && e.datos.tipo === 'nack').length === 1);
  const ruidoSolo = porElAire(new Float32Array(48000 * 3), 48000, { ruido: 0.1 });
  comprobar('solo ruido: no inventa tramas', ruidoSolo.length === 0);
  const t = M.construirTrama('Mensaje cortado', 1, 0);
  const audio = M.sintetizar(M.tonosDeTrama(M.valoresDeTrama(t), 50), 48000, 0.85).subarray(0, 48000 * 2);
  const ev3 = porElAire(audio, 48000, { ganancia: 0.1, ruido: 0.005, duracionBitMs: 50 });
  const tr = ev3.find((e) => e.nombre === 'trama');
  comprobar('señal cortada: aborta y marca la trama como dañada', !!tr && !tr.datos.valido && !!tr.datos.aborto);
}
{
  // Mucho ruido: Hamming debe rescatar más mensajes que el modo sin corrección
  let ok1 = 0, ok3 = 0;
  for (let i = 0; i < 12; i++) {
    for (const modo of [1, 3]) {
      const t = M.construirTrama('Telecom U2', modo, 0);
      const audio = M.sintetizar(M.tonosDeTrama(M.valoresDeTrama(t), 25), 48000, 0.85);
      const ev = porElAire(audio, 48000, { ganancia: 0.02, ruido: 0.045, duracionBitMs: 25 });
      const tr = ev.find((e) => e.nombre === 'trama');
      if (tr && tr.datos.valido) { if (modo === 1) ok1++; else ok3++; }
    }
  }
  console.log('  info  con ruido fuerte llegaron bien ' + ok1 + '/12 con CRC y ' + ok3 + '/12 con Hamming');
}

console.log(fallas === 0 ? '\nTodas las pruebas pasaron.' : '\nPruebas con falla: ' + fallas);
process.exit(fallas === 0 ? 0 : 1);
