// ============================================================
//  experimento.js — Mediciones (objetivo 4)
//  Series de tramas con un texto que el receptor ya conoce, para
//  contar bits erróneos según la distancia y el ruido, con y sin corrección.
// ============================================================

// Configuraciones que se comparan, con su color fijo (paleta validada para daltonismo).
const SERIES = {
  paridad: { nombre: 'Paridad + CRC', color: '#0b8f9c' },
  sin: { nombre: 'Sin protección', color: '#c2410c' },
  entrelazado: { nombre: 'Hamming con entrelazado', color: '#2c62d6' },
  hamming: { nombre: 'Hamming', color: '#b8388f' },
  arq: { nombre: 'CRC + ARQ', color: '#7c5c00' },
};

function serieDe(p) {
  if (p.modo === 3) return p.entrelazado ? 'entrelazado' : 'hamming';
  return ['sin', 'paridad', 'arq'][p.modo];
}

// ---------- Envío de una serie ----------

async function enviarSerie() {
  if (estado.enviando) return;
  const cantidad = Number($('serie-cantidad').value);
  const comparar = $('serie-comparar').value;
  const o = opcionesDelEmisor();
  let configuraciones;
  if (comparar === 'corrige') configuraciones = [{ modo: 1 }, { modo: 3 }];
  else if (comparar === 'entrelazado') configuraciones = [{ modo: 3 }, { modo: 3, entrelazado: true }];
  else configuraciones = [{ modo: o.modo === 2 ? 1 : o.modo, entrelazado: o.entrelazado }];
  const bytes = textoABytes(CONFIG.textoDePrueba);

  bloquearEnvios(true);
  try {
    await prepararAudio();
    if (ajustes.canal === 'aire' && audio.eco && !audio.microfonoActivo) await encenderMicrofono();
    estado.ultimoEnviado = CONFIG.textoDePrueba;
    const condicion = $('nota').value || 'sin condición';
    anotar('Serie de prueba: ' + cantidad + ' tramas (' + condicion + ').');
    diagrama.mensaje('Serie de prueba: ' + cantidad + ' tramas, sin respuesta');
    for (let i = 0; i < cantidad; i++) {
      const c = configuraciones[i % configuraciones.length];
      estado.idMensaje ^= 1;
      const envio = {
        base: { modo: c.modo, entrelazado: Boolean(c.entrelazado), paralelo: o.paralelo, variante: 0,
          id: estado.idMensaje, total: 1 },
        partes: [bytes], intentos: [0], titulo: 'Prueba ' + (i + 1) + ' de ' + cantidad + ', trama',
        sinDiagrama: true, silencioso: true,
      };
      await enviarTrama(envio, 0, false);
      await pausa(450);
    }
    anotar('Terminó la serie de prueba.', 'bien');
  } catch (error) {
    anotar(error.message, 'mal');
  } finally {
    bloquearEnvios(false);
    estadoDeReposo();
  }
}

// ---------- Registro de cada recepción ----------

function registrarRecepcion(r, resultado, tipo, comparacion) {
  const p = r.params;
  const fila = {
    configuracion: r.cabeceraOk ? nombreDeConfiguracion(p) : 'cabecera ilegible',
    baudios: baudios(),
    trama: r.cabeceraOk ? (p.num + 1) + ' de ' + p.total : '',
    resultado: { ok: 'Correcta', duplicada: 'Repetida', descartada: 'Descartada', danada: 'Dañada' }[resultado] || 'Dañada',
    tipo,
    bitsMalos: comparacion ? comparacion.errores + ' de ' + comparacion.total : '',
    corregidos: r.bitsCorregidos,
    nivel: r.nivelDb.toFixed(0) + ' dB',
    snr: r.snrDb === null ? '' : r.snrDb.toFixed(0) + ' dB',
    condicion: $('nota').value,
    texto: r.texto,
  };
  if (r.cabeceraOk && p.modo === 0) fila.resultado = 'Sin verificar';
  estado.registro.push(fila);
  pintarRegistro();

  if (comparacion && comparacion.esPrueba) {
    estado.mediciones.push({
      serie: serieDe(p), paralelo: p.paralelo, condicion: $('nota').value || 'sin condición',
      errores: comparacion.errores, total: comparacion.total, ber: 100 * comparacion.errores / comparacion.total,
      valido: r.valido, corregidos: r.bitsCorregidos, nivelDb: r.nivelDb, snrDb: r.snrDb,
    });
    pintarResumen();
    dibujarGraficas();
  }
}

function pintarRegistro() {
  const cuerpo = $('registro');
  cuerpo.textContent = '';
  if (estado.registro.length === 0) {
    cuerpo.innerHTML = '<tr class="vacio"><td colspan="10">Cada trama recibida agrega un renglón.</td></tr>';
    return;
  }
  estado.registro.forEach((f, i) => {
    const tr = document.createElement('tr');
    [i + 1, f.configuracion, f.baudios, f.trama, f.resultado, f.bitsMalos, f.corregidos, f.nivel, f.snr, f.condicion]
      .forEach((valor, k) => {
        const td = document.createElement('td');
        td.textContent = valor;
        if (k === 4) td.className = f.tipo;
        tr.append(td);
      });
    cuerpo.prepend(tr);
  });
}

function pintarResumen() {
  const cuerpo = $('resumen');
  cuerpo.textContent = '';
  if (estado.mediciones.length === 0) {
    cuerpo.innerHTML = '<tr class="vacio"><td colspan="8">Envía una serie para llenar esta tabla.</td></tr>';
    return;
  }
  const grupos = new Map();
  for (const m of estado.mediciones) {
    const clave = m.condicion + '|' + m.serie + '|' + m.paralelo;
    if (!grupos.has(clave)) grupos.set(clave, []);
    grupos.get(clave).push(m);
  }
  const promedio = (lista, campo) => lista.reduce((s, m) => s + m[campo], 0) / lista.length;
  for (const lista of grupos.values()) {
    const m0 = lista[0];
    const bien = lista.filter((m) => m.valido).length;
    const conSnr = lista.filter((m) => m.snrDb !== null);
    const tr = document.createElement('tr');
    const celdas = [
      m0.condicion,
      SERIES[m0.serie].nombre + (m0.paralelo ? ', en paralelo' : ''),
      lista.length,
      bien + ' de ' + lista.length + ' (' + Math.round(100 * bien / lista.length) + ' %)',
      promedio(lista, 'ber').toFixed(1) + ' %',
      lista.reduce((s, m) => s + m.corregidos, 0),
      promedio(lista, 'nivelDb').toFixed(0) + ' dB',
      conSnr.length ? promedio(conSnr, 'snrDb').toFixed(0) + ' dB' : '',
    ];
    celdas.forEach((valor, k) => {
      const td = document.createElement('td');
      if (k === 1) {
        const muestra = document.createElement('i');
        muestra.className = 'muestra';
        muestra.style.background = SERIES[m0.serie].color;
        td.append(muestra);
      }
      td.append(document.createTextNode(valor));
      tr.append(td);
    });
    cuerpo.append(tr);
  }
}

function descargarCSV() {
  const comillas = (v) => '"' + String(v).replace(/"/g, '""') + '"';
  const lineas = ['recepcion,configuracion,baudios,trama,resultado,bits_erroneos,bits_corregidos,nivel,senal_ruido,condicion,texto_recibido'];
  estado.registro.forEach((f, i) => {
    lineas.push([i + 1, f.configuracion, f.baudios, f.trama, f.resultado, f.bitsMalos, f.corregidos, f.nivel, f.snr,
      f.condicion, f.texto].map(comillas).join(','));
  });
  const enlace = document.createElement('a');
  enlace.href = URL.createObjectURL(new Blob(['﻿' + lineas.join('\r\n')], { type: 'text/csv' }));
  enlace.download = 'mediciones-modem-acustico.csv';
  enlace.click();
}

// ---------- Gráficas ----------

const TINTA = '#16213a', TINTA_SUAVE = '#56617b', REJILLA = '#e3e7ef', CRITICO = '#d93a40';
const graficas = {};

// Escala "bonita" para el eje Y
function techoBonito(valor, opciones) {
  for (const o of opciones) if (valor <= o) return o;
  return Math.ceil(valor / 10) * 10;
}

function prepararLienzo(id) {
  const lienzo = $(id);
  const escala = window.devicePixelRatio || 1;
  const W = lienzo.clientWidth, H = lienzo.clientHeight;
  lienzo.width = Math.round(W * escala);
  lienzo.height = Math.round(H * escala);
  const g = lienzo.getContext('2d');
  g.setTransform(escala, 0, 0, escala, 0, 0);
  g.clearRect(0, 0, W, H);
  return { lienzo, g, W, H };
}

// Geometría compartida: una columna por trama medida.
function columnas(W, n) {
  const izq = 46, der = 12;
  const ancho = (W - izq - der) / Math.max(n, 10);
  return { izq, der, ancho, x: (i) => izq + (i + 0.5) * ancho };
}

// Franjas de fondo, una por condición, con su nombre arriba.
function dibujarCondiciones(g, cols, arriba, abajo, datos) {
  let inicio = 0;
  let par = false;
  for (let i = 1; i <= datos.length; i++) {
    if (i === datos.length || datos[i].condicion !== datos[inicio].condicion) {
      const x0 = cols.izq + inicio * cols.ancho, x1 = cols.izq + i * cols.ancho;
      if (par) { g.fillStyle = '#f3f5f9'; g.fillRect(x0, arriba - 22, x1 - x0, abajo - arriba + 22); }
      g.save();
      g.beginPath(); g.rect(x0, arriba - 22, x1 - x0 - 4, 20); g.clip();
      g.fillStyle = TINTA_SUAVE;
      g.font = '600 12px "Segoe UI", system-ui, sans-serif';
      g.textAlign = 'left';
      g.fillText(datos[inicio].condicion, x0 + 4, arriba - 8);
      g.restore();
      inicio = i;
      par = !par;
    }
  }
}

function ejeY(g, cols, W, arriba, abajo, min, max, formato) {
  g.font = '12px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'right';
  g.textBaseline = 'middle';
  for (const v of [min, (min + max) / 2, max]) {
    const y = abajo - (v - min) / (max - min) * (abajo - arriba);
    g.strokeStyle = REJILLA;
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(cols.izq, Math.round(y) + 0.5); g.lineTo(W - cols.der, Math.round(y) + 0.5); g.stroke();
    g.fillStyle = TINTA_SUAVE;
    g.fillText(formato(v), cols.izq - 8, y);
  }
  g.textBaseline = 'alphabetic';
}

function ejeX(g, cols, abajo, n) {
  g.fillStyle = TINTA_SUAVE;
  g.font = '12px "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  const paso = cols.ancho < 22 ? Math.ceil(22 / cols.ancho) : 1;
  for (let i = 0; i < n; i += paso) g.fillText(String(i + 1), cols.x(i), abajo + 16);
}

function dibujarGraficas() {
  const datos = estado.mediciones;

  // Leyenda: solo las configuraciones presentes
  const leyenda = $('leyenda-series');
  leyenda.textContent = '';
  const presentes = Object.keys(SERIES).filter((k) => datos.some((m) => m.serie === k));
  if (presentes.length > 1) {
    for (const k of presentes) {
      const item = document.createElement('span');
      const muestra = document.createElement('i');
      muestra.className = 'muestra';
      muestra.style.background = SERIES[k].color;
      item.append(muestra, document.createTextNode(SERIES[k].nombre));
      leyenda.append(item);
    }
    const falla = document.createElement('span');
    falla.className = 'leyenda-falla';
    falla.textContent = '✕ la trama llegó dañada';
    leyenda.append(falla);
  }

  // --- Bits erróneos (barras) ---
  {
    const { g, W, H } = prepararLienzo('grafica-errores');
    const arriba = 34, abajo = H - 24;
    const cols = columnas(W, datos.length);
    if (datos.length === 0) {
      g.fillStyle = TINTA_SUAVE; g.font = '14px "Segoe UI", system-ui, sans-serif'; g.textAlign = 'center';
      g.fillText('Envía una serie de prueba para ver los resultados.', W / 2, H / 2);
    } else {
      dibujarCondiciones(g, cols, arriba, abajo, datos);
      const max = techoBonito(Math.max(...datos.map((m) => m.ber)), [5, 10, 20, 30, 50, 100]);
      ejeY(g, cols, W, arriba, abajo, 0, max, (v) => v + ' %');
      const anchoBarra = Math.min(26, cols.ancho * 0.62);
      datos.forEach((m, i) => {
        const alto = Math.max(2, m.ber / max * (abajo - arriba));
        const x = cols.x(i) - anchoBarra / 2;
        g.fillStyle = SERIES[m.serie].color;
        if (graficas.resaltada === i) g.globalAlpha = 0.75;
        g.beginPath();
        g.roundRect(x, abajo - alto, anchoBarra, alto, [Math.min(4, alto / 2), Math.min(4, alto / 2), 0, 0]);
        g.fill();
        g.globalAlpha = 1;
        if (!m.valido) {
          g.fillStyle = CRITICO;
          g.font = '700 13px "Segoe UI", system-ui, sans-serif';
          g.textAlign = 'center';
          g.fillText('✕', cols.x(i), abajo - alto - 5);
        }
      });
      g.strokeStyle = TINTA; g.lineWidth = 1;
      g.beginPath(); g.moveTo(cols.izq, abajo + 0.5); g.lineTo(W - cols.der, abajo + 0.5); g.stroke();
      ejeX(g, cols, abajo, datos.length);
    }
    graficas.errores = { cols, n: datos.length };
  }

  // --- Señal/ruido (línea) ---
  {
    const { g, W, H } = prepararLienzo('grafica-snr');
    const arriba = 14, abajo = H - 24;
    const cols = columnas(W, datos.length);
    const conSnr = datos.map((m, i) => ({ i, v: m.snrDb })).filter((p) => p.v !== null);
    if (conSnr.length > 0) {
      const valores = conSnr.map((p) => p.v);
      const min = Math.floor(Math.min(0, ...valores) / 10) * 10;
      const max = Math.max(min + 10, Math.ceil(Math.max(...valores) / 10) * 10);
      ejeY(g, cols, W, arriba, abajo, min, max, (v) => Math.round(v) + ' dB');
      const y = (v) => abajo - (v - min) / (max - min) * (abajo - arriba);
      g.strokeStyle = TINTA; g.lineWidth = 2; g.lineJoin = 'round';
      g.beginPath();
      conSnr.forEach((p, k) => (k === 0 ? g.moveTo(cols.x(p.i), y(p.v)) : g.lineTo(cols.x(p.i), y(p.v))));
      g.stroke();
      for (const p of conSnr) {
        g.fillStyle = '#ffffff';
        g.beginPath(); g.arc(cols.x(p.i), y(p.v), 5, 0, 2 * Math.PI); g.fill();
        g.fillStyle = graficas.resaltada === p.i ? SERIES[datos[p.i].serie].color : TINTA;
        g.beginPath(); g.arc(cols.x(p.i), y(p.v), 4, 0, 2 * Math.PI); g.fill();
      }
      ejeX(g, cols, abajo, datos.length);
    }
    graficas.snr = { cols, n: datos.length };
  }
}

// Tooltip: al pasar el puntero (o con las flechas del teclado) sobre una columna.
function mostrarDetalle(i, lienzo) {
  const tip = $('tooltip');
  const m = estado.mediciones[i];
  if (!m) { tip.hidden = true; graficas.resaltada = null; dibujarGraficas(); return; }
  graficas.resaltada = i;
  dibujarGraficas();
  tip.textContent = '';
  const valor = document.createElement('strong');
  valor.textContent = m.ber.toFixed(1) + ' % de bits erróneos';
  const filas = [
    SERIES[m.serie].nombre + (m.paralelo ? ', en paralelo' : ''),
    'Prueba ' + (i + 1) + ': ' + m.condicion,
    m.errores + ' de ' + m.total + ' bits llegaron mal',
    m.valido ? 'La trama llegó bien' + (m.corregidos ? ' (Hamming corrigió ' + m.corregidos + ')' : '') : 'La trama llegó dañada',
    m.snrDb === null ? 'Nivel ' + m.nivelDb.toFixed(0) + ' dB' : 'Nivel ' + m.nivelDb.toFixed(0) + ' dB, S/N ' + m.snrDb.toFixed(0) + ' dB',
  ];
  const clave = document.createElement('span');
  clave.className = 'tooltip-clave';
  clave.style.background = SERIES[m.serie].color;
  tip.append(clave, valor);
  for (const texto of filas) {
    const linea = document.createElement('span');
    linea.textContent = texto;
    tip.append(linea);
  }
  tip.hidden = false;
  const cols = graficas.errores.cols;
  const caja = lienzo.parentElement.getBoundingClientRect();
  const x = cols.x(i) + (lienzo.getBoundingClientRect().left - caja.left);
  const izquierda = x + 14 + tip.offsetWidth > caja.width ? x - 14 - tip.offsetWidth : x + 14;
  tip.style.left = Math.max(0, izquierda) + 'px';
  tip.style.top = '30px';
}

function iniciarGraficas() {
  for (const id of ['grafica-errores', 'grafica-snr']) {
    const lienzo = $(id);
    lienzo.tabIndex = 0;
    const clave = id === 'grafica-errores' ? 'errores' : 'snr';
    lienzo.addEventListener('pointermove', (e) => {
      const g = graficas[clave];
      if (!g || g.n === 0) return;
      const x = e.clientX - lienzo.getBoundingClientRect().left;
      const i = Math.floor((x - g.cols.izq) / g.cols.ancho);
      if (i !== graficas.resaltada) mostrarDetalle(i >= 0 && i < g.n ? i : -1, $('grafica-errores'));
    });
    lienzo.addEventListener('pointerleave', () => mostrarDetalle(-1, lienzo));
    lienzo.addEventListener('blur', () => mostrarDetalle(-1, lienzo));
    lienzo.addEventListener('keydown', (e) => {
      const n = estado.mediciones.length;
      if (n === 0 || (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft')) return;
      e.preventDefault();
      const actual = graficas.resaltada ?? -1;
      const i = e.key === 'ArrowRight' ? Math.min(n - 1, actual + 1) : Math.max(0, actual - 1);
      mostrarDetalle(i, $('grafica-errores'));
    });
  }
  window.addEventListener('resize', dibujarGraficas);
  dibujarGraficas();
}
