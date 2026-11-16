// ============================================================
//  matriz.js — "Dentro de Hamming": los grupos de 7 bits de una trama
//
//  Cada columna es un grupo (4 datos + 3 de control); cada byte usa dos columnas.
//  Sin entrelazar, el sonido recorre la matriz columna por columna:
//  una ráfaga daña varios bits del MISMO grupo y Hamming no alcanza.
//  Con entrelazado la recorre renglón por renglón: la ráfaga queda
//  repartida, un bit por grupo, y Hamming corrige todos.
// ============================================================

const RENGLONES_HAMMING = [
  { nombre: 'b4', posicion: 7 }, { nombre: 'b3', posicion: 6 }, { nombre: 'b2', posicion: 5 },
  { nombre: 'k3', posicion: 4 }, { nombre: 'b1', posicion: 3 }, { nombre: 'k2', posicion: 2 },
  { nombre: 'k1', posicion: 1 },
];

// r = resultado del receptor; errores = Set con los índices lógicos que llegaron mal (o null).
function pintarMatriz(r, errores, esperados) {
  const caja = document.getElementById('matriz');
  const nota = document.getElementById('matriz-nota');
  caja.textContent = '';
  if (!r || !r.cabeceraOk || r.params.modo !== 3 || !r.completa) {
    nota.textContent = 'Recibe una trama en modo Hamming para ver sus grupos de 7 bits.';
    return;
  }
  const plan = r.plan;
  const grupos = plan.total / 7;
  const corregidos = new Set();
  r.decodificados.forEach((d) => d && d.corregidasLogicas.forEach((j) => corregidos.add(j)));

  // Orden en que cada bit sonó en el aire (para el título de cada celda)
  const ordenAire = [];
  let k = 0;
  plan.elementos.forEach((el) => el.indices.forEach((i) => { ordenAire[i] = ++k; }));

  const p = r.params;
  nota.textContent = (p.entrelazado
    ? 'Con entrelazado: el sonido recorre la matriz renglón por renglón. Una ráfaga queda repartida, un bit por grupo.'
    : 'Sin entrelazar: el sonido recorre la matriz columna por columna. Una ráfaga cae dentro del mismo grupo.') +
    ' Cada columna es un grupo de 7 bits y cada byte usa dos.';

  const tabla = document.createElement('div');
  tabla.className = 'matriz' + (p.entrelazado ? ' entrelazada' : '');
  tabla.style.gridTemplateColumns = 'auto repeat(' + grupos + ', var(--celda))';

  // Renglón de bytes: cada byte ocupa dos columnas
  tabla.append(document.createElement('span'));
  for (let c = 0; c < plan.nCaracteres; c++) {
    const d = r.decodificados[c];
    const etiqueta = document.createElement('span');
    etiqueta.className = 'matriz-byte' + (c >= p.longitud ? ' es-crc' : '');
    etiqueta.style.gridColumn = 'span 2';
    etiqueta.textContent = c < p.longitud ? etiquetaDeElemento('datos', d.byte) : 'CRC';
    if (esperados && esperados.cuerpo[c] !== d.byte) etiqueta.classList.add('malo');
    tabla.append(etiqueta);
  }

  RENGLONES_HAMMING.forEach((renglon, fila) => {
    const nombre = document.createElement('span');
    nombre.className = 'matriz-renglon';
    nombre.textContent = renglon.nombre;
    tabla.append(nombre);
    for (let g = 0; g < grupos; g++) {
      const j = g * 7 + fila;
      const v = r.logicos[j];
      const celda = document.createElement('i');
      celda.className = 'bit t-' + plan.tiposLogicos[j] + (v === 1 ? ' v1' : '');
      celda.textContent = v;
      const llegoMal = errores ? errores.has(j) : corregidos.has(j);
      if (corregidos.has(j) && llegoMal) celda.classList.add('e-corregido');
      else if (llegoMal) celda.classList.add('e-error');
      else if (corregidos.has(j)) celda.classList.add('e-error', 'mal-corregido');
      celda.title = 'Grupo ' + (g + 1) + ', ' + renglon.nombre + ' (posición ' + renglon.posicion + '). Sonó en el lugar ' +
        ordenAire[j] + ' del cuerpo.';
      tabla.append(celda);
    }
  });
  caja.append(tabla);

  // Resumen debajo
  const fallidos = [];
  for (let g = 0; g < grupos; g++) {
    let n = 0;
    for (let f = 0; f < 7; f++) if (errores && errores.has(g * 7 + f)) n++;
    if (n > 1) fallidos.push(g + 1);
  }
  const resumen = document.createElement('p');
  resumen.className = 'matriz-resumen';
  if (errores) {
    resumen.textContent = errores.size === 0 ? 'Ningún bit del cuerpo llegó mal.'
      : errores.size + (errores.size === 1 ? ' bit llegó mal' : ' bits llegaron mal') + '; Hamming corrigió ' +
        [...errores].filter((j) => corregidos.has(j)).length + '.' +
        (fallidos.length === 1 ? ' El grupo ' + fallidos[0] + ' tuvo más de un error y no se pudo corregir.'
          : fallidos.length > 1 ? ' Los grupos ' + fallidos.join(', ') + ' tuvieron más de un error y no se pudieron corregir.' : '');
  } else {
    resumen.textContent = corregidos.size === 0 ? 'Hamming no tuvo que corregir nada.'
      : 'Hamming corrigió ' + corregidos.size + (corregidos.size === 1 ? ' bit.' : ' bits.') +
        ' Escribe el texto esperado para ver también los errores que no alcanzó a corregir.';
  }
  caja.append(resumen);
}
