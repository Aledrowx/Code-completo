// ====================================================================
// 📚 MÓDULO 3: CÁLCULO, ÍNDICES Y ENSAMBLAJE DE TOMOS
// ====================================================================

var ID_SELECCION_MANUAL_TOMOS = 'SELECCION_MANUAL_PDF';

function procesarCalculoMatematico(seleccionados, config) {
  var filtrados = filtrarSeleccionadosMasEspecificos(seleccionados);
  var archivos = [];
  var omitidos = [];
  var idsVistos = {};

  filtrados.forEach(function(sel) {
    if (sel.id === ID_SELECCION_MANUAL_TOMOS) return;
    var infoAnexo = extraerInfoAnexo_(sel.name);
    var carpeta = DriveApp.getFolderById(sel.id);

    var nivel = (config && config.nivelProfundidad) ? config.nivelProfundidad : 'general';
    var encontrados;
    if (nivel === 'general') {
      encontrados = listarPdfsRecursivo(carpeta, [sel.name]);
    } else {
      var nivelNum = parseInt(nivel, 10);
      if (isNaN(nivelNum) || nivelNum < 1) nivelNum = 1;
      encontrados = listarPdfsHastaNivel(carpeta, [sel.name], nivelNum);
    }

    encontrados.forEach(function(item) {
      var file = item.file;
      if (idsVistos[file.getId()]) return;
      idsVistos[file.getId()] = true;

      var paginas = extraerPaginasDelNombre_(file.getName());
      if (!paginas) {
        omitidos.push({
          id: file.getId(),
          nombre: file.getName(),
          url: file.getUrl(),
          carpetaOrigen: sel.name,
          carpetaOrigenId: sel.id,
          ruta: item.path.join(' / '),
          motivo: 'El nombre no contiene una cantidad de páginas reconocible.'
        });
        return;
      }

      archivos.push({
        id: file.getId(),
        nombreOriginal: file.getName(),
        esNumerado: infoAnexo.esNumerado,
        segmentos: infoAnexo.segmentos.slice(),
        numAnexoStr: infoAnexo.numAnexoStr,
        descAnexo: infoAnexo.descAnexo,
        paginasFisicas: paginas,
        paginasFoleo: paginas,
        tamano: Number(file.getSize()) || 0,
        actualizadoMs: file.getLastUpdated().getTime(),
        carpetaOrigen: sel.name,
        carpetaOrigenId: sel.id,
        ruta: item.path.join(' / ')
      });
    });
  });

  var pdfsManual = (config && Array.isArray(config.pdfsManual)) ? config.pdfsManual : [];
  pdfsManual.forEach(function(p) {
    if (!p || !p.id || idsVistos[p.id]) return;
    idsVistos[p.id] = true;
    try {
      var file = DriveApp.getFileById(p.id);
      var paginas = extraerPaginasDelNombre_(file.getName()) || Number(p.paginas) || 0;
      if (!paginas) {
        var conteo = obtenerPaginasDePdf(file.getId());
        if (conteo.length && conteo[0].paginas > 0) paginas = conteo[0].paginas;
      }
      if (!paginas) {
        omitidos.push({
          id: p.id,
          nombre: file.getName(),
          url: file.getUrl(),
          carpetaOrigen: p.carpetaOrigen || 'Selección manual',
          carpetaOrigenId: ID_SELECCION_MANUAL_TOMOS,
          ruta: p.carpetaOrigen || 'Selección manual',
          motivo: 'No se pudo determinar la cantidad de páginas de este PDF.'
        });
        return;
      }

      var nombreCarpetaReal = p.carpetaOrigen ? String(p.carpetaOrigen) : '';
      var infoAnexoManual = nombreCarpetaReal
        ? extraerInfoAnexo_(nombreCarpetaReal)
        : { esNumerado: false, segmentos: [], numAnexoStr: '', descAnexo: '' };

      archivos.push({
        id: file.getId(),
        nombreOriginal: file.getName(),
        esNumerado: infoAnexoManual.esNumerado,
        segmentos: infoAnexoManual.segmentos.slice(),
        numAnexoStr: infoAnexoManual.numAnexoStr,
        descAnexo: infoAnexoManual.descAnexo,
        paginasFisicas: paginas,
        paginasFoleo: paginas,
        tamano: Number(file.getSize()) || 0,
        actualizadoMs: file.getLastUpdated().getTime(),
        carpetaOrigen: nombreCarpetaReal || 'Selección manual',
        carpetaOrigenId: ID_SELECCION_MANUAL_TOMOS,
        ruta: nombreCarpetaReal || 'Selección manual',
        forzarTomoManual: true
      });
    } catch (error) {
      omitidos.push({
        id: p.id,
        nombre: p.name || p.id,
        url: '',
        carpetaOrigen: p.carpetaOrigen || 'Selección manual',
        carpetaOrigenId: ID_SELECCION_MANUAL_TOMOS,
        ruta: '',
        motivo: 'No se pudo abrir el archivo: ' + error.message
      });
    }
  });

  if (!archivos.length) return { tomos: [], omitidos: omitidos };

  var archivosManual = archivos.filter(function(a) { return a.forzarTomoManual; });
  var archivosAuto = archivos.filter(function(a) { return !a.forzarTomoManual; });

  archivosAuto.sort(compararArchivosTomos_);

  var tomos = [];
  var actual = crearTomoVacio_(1);
  // 👇 FIX: ahora la capacidad respeta config.paginasPorTomo si viene desde la interfaz
  var capacidadContenido = obtenerCapacidadContenidoTomo_(config);

  archivosAuto.forEach(function(pdf) {
    if (actual.archivos.length && actual.totalContenido + pdf.paginasFisicas > capacidadContenido) {
      tomos.push(actual);
      actual = crearTomoVacio_(tomos.length + 1);
    }
    agregarPdfATomo_(actual, pdf);
  });

  if (actual.archivos.length) tomos.push(actual);

  // 👇 FIX: se propaga config para que también respete el límite manual al fusionar tomos pequeños
  tomos = absorberTomosPequenosSeguro_(tomos, config);

  if (archivosManual.length) {
    var tomoManual = crearTomoVacio_(tomos.length + 1);
    archivosManual.forEach(function(pdf) { agregarPdfATomo_(tomoManual, pdf); });
    tomoManual.excedeLimite = tomoManual.totalContenido > capacidadContenido;
    tomos.push(tomoManual);
  }

  // 👇 FIX: se propaga config para que excedeLimite se calcule contra el límite correcto
  recalcularTomos_(tomos, config);
  return { tomos: tomos, omitidos: omitidos };
}

function obtenerReservaCaratulaTomo_() {
  var valor = Number(obtenerValorConfigSistema_('CARATULAS_NO_FOLIADAS_POR_TOMO', 1));
  return isFinite(valor) && valor >= 0 ? Math.floor(valor) : 1;
}

// 👇 NUEVA FUNCIÓN: resuelve el límite de páginas por tomo priorizando lo que
// el usuario configuró en la interfaz (config.paginasPorTomo). Si no viene
// nada válido, cae de vuelta al valor fijo del sistema (comportamiento anterior).
function obtenerLimitePaginasTomo_(config) {
  var limiteConfig = Number(config && config.paginasPorTomo);
  if (isFinite(limiteConfig) && limiteConfig > 0) return Math.floor(limiteConfig);
  return Number(obtenerValorConfigSistema_('LIMITE_PAGINAS', 600));
}

// 👇 FIX: ahora recibe config y usa obtenerLimitePaginasTomo_ en vez del valor fijo
function obtenerCapacidadContenidoTomo_(config) {
  var limite = obtenerLimitePaginasTomo_(config);
  var reserva = obtenerReservaCaratulaTomo_();
  return Math.max(1, Math.floor(limite) - reserva);
}

function extraerInfoAnexo_(nombreCarpeta) {
  var nombre = String(nombreCarpeta || '').trim();
  var match = nombre.match(/^(?:ANEXO\s*)?(\d+(?:\.\d+)*)\.?\s*(.*)/i);
  var esNumerado = Boolean(match);
  var numero = esNumerado ? match[1] : '';
  var descripcionBruta = esNumerado ? match[2] : nombre;
  descripcionBruta = descripcionBruta.replace(/^[\s.\-–—_:]+/, '').trim();
  var descripcion = descripcionBruta
    ? descripcionBruta.charAt(0).toUpperCase() + descripcionBruta.slice(1).toLowerCase()
    : '';
  return {
    esNumerado: esNumerado,
    segmentos: esNumerado ? numero.split('.').map(function(v) { return parseInt(v, 10); }) : [],
    numAnexoStr: numero,
    descAnexo: descripcion
  };
}

function extraerPaginasDelNombre_(nombre) {
  var match = String(nombre || '').match(/\((\d+)\s*p[aá]g(?:\.|ina)?s?\s*\)/i);
  return match ? parseInt(match[1], 10) : 0;
}

function normalizarPdfOmitido_(omitido) {
  if (omitido && typeof omitido === 'object') {
    return {
      id: omitido.id ? String(omitido.id) : '',
      nombre: omitido.nombre ? String(omitido.nombre) : 'PDF sin nombre',
      url: omitido.url ? String(omitido.url) : '',
      carpetaOrigen: omitido.carpetaOrigen ? String(omitido.carpetaOrigen) : '',
      ruta: omitido.ruta ? String(omitido.ruta) : '',
      motivo: omitido.motivo ? String(omitido.motivo) : 'No se pudo determinar la cantidad de páginas.'
    };
  }
  return {
    id: '',
    nombre: String(omitido || 'PDF sin nombre'),
    url: '',
    carpetaOrigen: '',
    ruta: '',
    motivo: 'No se pudo determinar la cantidad de páginas.'
  };
}

function ordenarPdfsOmitidos_(omitidos) {
  return (omitidos || []).map(normalizarPdfOmitido_).sort(function(a, b) {
    var porCarpeta = a.carpetaOrigen.localeCompare(b.carpetaOrigen, 'es', { numeric: true, sensitivity: 'base' });
    if (porCarpeta !== 0) return porCarpeta;
    return a.nombre.localeCompare(b.nombre, 'es', { numeric: true, sensitivity: 'base' });
  });
}

function crearFilasPdfsOmitidos_(omitidos) {
  var lista = ordenarPdfsOmitidos_(omitidos);
  if (!lista.length) return [];
  var filas = [['', '⚠️ PDF OMITIDOS (' + lista.length + ')', 'No incluidos en la proyección', 'Corrige el nombre y vuelve a ejecutar “1. Proyectar”.', '']];
  lista.forEach(function(omitido) {
    var ubicacion = [];
    if (omitido.carpetaOrigen) ubicacion.push('Carpeta: ' + omitido.carpetaOrigen);
    if (omitido.ruta) ubicacion.push('Ruta: ' + omitido.ruta);
    filas.push(['', 'PDF OMITIDO', omitido.nombre, omitido.motivo + (ubicacion.length ? ' | ' + ubicacion.join(' | ') : ''), omitido.url]);
  });
  return filas;
}

function resumenPdfsOmitidos_(omitidos, limite) {
  var lista = ordenarPdfsOmitidos_(omitidos);
  var maximo = Math.max(1, Number(limite) || 6);
  var nombres = lista.slice(0, maximo).map(function(item) { return item.nombre; });
  if (!nombres.length) return '';
  return nombres.join(' | ') + (lista.length > maximo ? ' | … y ' + (lista.length - maximo) + ' más' : '');
}

function compararArchivosTomos_(a, b) {
  if (a.esNumerado !== b.esNumerado) return a.esNumerado ? 1 : -1;
  if (a.esNumerado) {
    var max = Math.max(a.segmentos.length, b.segmentos.length);
    for (var i = 0; i < max; i++) {
      if (i >= a.segmentos.length) return -1;
      if (i >= b.segmentos.length) return 1;
      if (a.segmentos[i] !== b.segmentos[i]) return a.segmentos[i] - b.segmentos[i];
    }
  }
  return a.nombreOriginal.localeCompare(b.nombreOriginal, 'es', { numeric: true, sensitivity: 'base' });
}

function crearTomoVacio_(numero) {
  return { numero: numero, archivos: [], totalContenido: 0, totalFisicas: 0, totalFoleo: 0, excedeLimite: false };
}

function agregarPdfATomo_(tomo, pdf) {
  tomo.archivos.push(pdf);
  tomo.totalContenido += pdf.paginasFisicas;
  tomo.totalFoleo += pdf.paginasFoleo;
  tomo.totalFisicas = tomo.totalContenido + obtenerReservaCaratulaTomo_();
}

// 👇 FIX: ahora recibe config y lo usa para el límite real y para recalcular
function absorberTomosPequenosSeguro_(tomos, config) {
  var salida = tomos.slice();
  var limite = obtenerLimitePaginasTomo_(config);
  var minimo = Number(obtenerValorConfigSistema_('LIMITE_MINIMO_TOMO', 150));
  var reserva = obtenerReservaCaratulaTomo_();
  var i = 0;

  function paginasFinalesCombinadas(a, b) { return a.totalContenido + b.totalContenido + reserva; }

  while (i < salida.length && salida.length > 1) {
    var tomo = salida[i];
    if (tomo.totalFisicas >= minimo) { i++; continue; }
    if (i > 0 && paginasFinalesCombinadas(salida[i - 1], tomo) <= limite) {
      salida[i - 1].archivos = salida[i - 1].archivos.concat(tomo.archivos);
      salida.splice(i, 1);
      recalcularTomoIndividual_(salida[i - 1], config);
      i = Math.max(0, i - 1);
      continue;
    }
    if (i < salida.length - 1 && paginasFinalesCombinadas(tomo, salida[i + 1]) <= limite) {
      tomo.archivos = tomo.archivos.concat(salida[i + 1].archivos);
      salida.splice(i + 1, 1);
      recalcularTomoIndividual_(tomo, config);
      continue;
    }
    i++;
  }
  return salida;
}

// 👇 FIX: ahora recibe config y calcula excedeLimite contra el límite real (manual o del sistema)
function recalcularTomoIndividual_(tomo, config) {
  tomo.totalContenido = 0;
  tomo.totalFoleo = 0;
  tomo.archivos.forEach(function(pdf) {
    pdf.startFoleo = tomo.totalFoleo + 1;
    pdf.endFoleo = tomo.totalFoleo + pdf.paginasFoleo;
    tomo.totalContenido += pdf.paginasFisicas;
    tomo.totalFoleo += pdf.paginasFoleo;
  });
  tomo.totalFisicas = tomo.totalContenido + obtenerReservaCaratulaTomo_();
  tomo.excedeLimite = tomo.totalFisicas > obtenerLimitePaginasTomo_(config);
}

// 👇 FIX: ahora recibe config y lo propaga a recalcularTomoIndividual_
function recalcularTomos_(tomos, config) {
  tomos.forEach(function(tomo, indice) {
    tomo.numero = indice + 1;
    recalcularTomoIndividual_(tomo, config);
  });
}

function seleccionarTomos_(tomos, config) {
  var texto = String((config && config.numerosTomos) || '').trim();
  if (!texto) return tomos.slice();
  var elegidos = {};
  texto.split(',').forEach(function(valor) {
    var n = parseInt(valor.trim(), 10);
    if (!isNaN(n) && n > 0) elegidos[n] = true;
  });
  var seleccionados = tomos.filter(function(tomo) { return Boolean(elegidos[tomo.numero]); });
  if (!seleccionados.length) throw new Error('No se indicó ningún número de tomo válido.');
  return seleccionados;
}

function resolverNumeracionTomos_(tomosSeleccionados, totalAutomatico, config) {
  var usarManual = Boolean(config && config.usarNumeracionManual);
  var inicio, totalVisible;
  if (usarManual) {
    inicio = parseInt(config.numeroInicialTomo, 10);
    totalVisible = parseInt(config.totalGeneralTomos, 10);
    if (isNaN(inicio) || inicio < 1) throw new Error('El número inicial manual del tomo debe ser mayor que cero.');
    if (isNaN(totalVisible) || totalVisible < 1) throw new Error('El total general manual de tomos debe ser mayor que cero.');
    var ultimoManual = inicio + tomosSeleccionados.length - 1;
    if (ultimoManual > totalVisible) throw new Error('La numeración manual terminaría en el tomo ' + ultimoManual + ', pero el total general indicado es ' + totalVisible + '.');
  } else {
    inicio = 0;
    totalVisible = totalAutomatico;
  }
  var ultimoVisible = usarManual ? inicio + tomosSeleccionados.length - 1 : totalAutomatico;
  var ancho = Math.max(2, String(Math.max(totalVisible, ultimoVisible)).length);
  return tomosSeleccionados.map(function(tomo, indice) {
    var numeroVisible = usarManual ? inicio + indice : tomo.numero;
    return {
      tomo: tomo,
      numeroProyectado: tomo.numero,
      numeroVisible: numeroVisible,
      totalVisible: totalVisible,
      numeroTexto: formatearNumeroMinimo_(numeroVisible, ancho),
      totalTexto: formatearNumeroMinimo_(totalVisible, ancho),
      ancho: ancho,
      manual: usarManual
    };
  });
}

function etiquetaNumeracionTomo_(numeracion) {
  return numeracion.numeroTexto + '/' + numeracion.totalTexto;
}

var CLAVE_PROYECCION_TOMOS_ = 'ULTIMA_PROYECCION_TOMOS_V2';
var TAMANO_FRAGMENTO_PROYECCION_ = 5000;

function guardarJsonFragmentadoTomos_(claveBase, objeto) {
  var propiedades = PropertiesService.getDocumentProperties();
  var metaAnterior = parsearJsonSeguro(propiedades.getProperty(claveBase + '_META'));
  if (metaAnterior && metaAnterior.fragmentos) {
    for (var anterior = 0; anterior < Number(metaAnterior.fragmentos); anterior++) {
      propiedades.deleteProperty(claveBase + '_PARTE_' + anterior);
    }
  }
  var contenido = JSON.stringify(objeto);
  var fragmentos = Math.max(1, Math.ceil(contenido.length / TAMANO_FRAGMENTO_PROYECCION_));
  var valores = {};
  for (var i = 0; i < fragmentos; i++) {
    valores[claveBase + '_PARTE_' + i] = contenido.substring(i * TAMANO_FRAGMENTO_PROYECCION_, (i + 1) * TAMANO_FRAGMENTO_PROYECCION_);
  }
  valores[claveBase + '_META'] = JSON.stringify({ fragmentos: fragmentos, longitud: contenido.length, version: 2, actualizado: Date.now() });
  propiedades.setProperties(valores, false);
}

function leerJsonFragmentadoTomos_(claveBase) {
  var propiedades = PropertiesService.getDocumentProperties();
  var meta = parsearJsonSeguro(propiedades.getProperty(claveBase + '_META'));
  if (!meta || !meta.fragmentos) return null;
  var partes = [];
  for (var i = 0; i < Number(meta.fragmentos); i++) {
    var parte = propiedades.getProperty(claveBase + '_PARTE_' + i);
    if (parte === null || parte === undefined) return null;
    partes.push(parte);
  }
  var contenido = partes.join('');
  if (meta.longitud !== undefined && Number(meta.longitud) !== contenido.length) return null;
  return parsearJsonSeguro(contenido);
}

function crearResumenProyeccionTomos_(seleccionados, calculo) {
  return {
    version: 2,
    created: Date.now(),
    totalTomos: calculo.tomos.length,
    seleccion: (seleccionados || []).map(function(item) {
      return { id: item && item.id ? String(item.id) : '', name: item && item.name ? String(item.name) : '' };
    }).filter(function(item) { return Boolean(item.id); }),
    tomos: calculo.tomos.map(function(tomo) {
      return {
        numero: tomo.numero,
        totalContenido: tomo.totalContenido,
        totalFisicas: tomo.totalFisicas,
        totalFoleo: tomo.totalFoleo,
        excedeLimite: Boolean(tomo.excedeLimite),
        archivos: tomo.archivos.map(function(archivo) {
          return {
            id: archivo.id,
            nombreOriginal: archivo.nombreOriginal,
            esNumerado: Boolean(archivo.esNumerado),
            segmentos: archivo.segmentos || [],
            numAnexoStr: archivo.numAnexoStr || '',
            descAnexo: archivo.descAnexo || '',
            paginasFisicas: Number(archivo.paginasFisicas) || 0,
            paginasFoleo: Number(archivo.paginasFoleo) || 0,
            tamano: Number(archivo.tamano) || 0,
            actualizadoMs: Number(archivo.actualizadoMs) || 0,
            carpetaOrigen: archivo.carpetaOrigen || '',
            carpetaOrigenId: archivo.carpetaOrigenId || '',
            ruta: archivo.ruta || '',
            startFoleo: Number(archivo.startFoleo) || 0,
            endFoleo: Number(archivo.endFoleo) || 0
          };
        })
      };
    }),
    omitidos: calculo.omitidos || []
  };
}

function guardarUltimaProyeccion_(seleccionados, calculo, pdfsManual) {
  var resumen = crearResumenProyeccionTomos_(seleccionados, calculo);
  resumen.seleccionManual = (pdfsManual || []).map(function(item) {
    return { id: item && item.id ? String(item.id) : '' };
  }).filter(function(item) { return Boolean(item.id); });
  guardarJsonFragmentadoTomos_(CLAVE_PROYECCION_TOMOS_, resumen);
  PropertiesService.getDocumentProperties().setProperty('ULTIMA_PROYECCION_TOMOS', JSON.stringify({
    totalTomos: resumen.totalTomos,
    seleccionIds: resumen.seleccion.map(function(item) { return item.id; }).sort(),
    created: resumen.created,
    version: resumen.version
  }));
}

function cargarUltimaProyeccionTomos_() {
  var proyeccion = leerJsonFragmentadoTomos_(CLAVE_PROYECCION_TOMOS_);
  if (!proyeccion || Number(proyeccion.version) !== 2 || !Array.isArray(proyeccion.tomos) || !proyeccion.tomos.length || !Array.isArray(proyeccion.seleccion)) {
    return null;
  }
  proyeccion.totalTomos = Number(proyeccion.totalTomos || proyeccion.tomos.length);
  return proyeccion;
}

function validarUltimaProyeccionVigente_(proyeccion) {
  if (!Boolean(obtenerValorConfigSistema_('VALIDAR_PROYECCION_TOMOS', true))) return;
  var cache = CacheService.getDocumentCache();
  var cacheKey = 'PROYECCION_OK_' + String(proyeccion.created || '0');
  if (cache.get(cacheKey) === '1') return;
  var cambios = [];
  var limiteMostrar = Number(obtenerValorConfigSistema_('MAX_CAMBIOS_PROYECCION_MOSTRAR', 8));
  (proyeccion.tomos || []).some(function(tomo) {
    return (tomo.archivos || []).some(function(archivo) {
      try {
        var file = DriveApp.getFileById(archivo.id);
        var cambiado = file.isTrashed() || file.getName() !== archivo.nombreOriginal || Number(file.getSize()) !== Number(archivo.tamano || 0) || file.getLastUpdated().getTime() !== Number(archivo.actualizadoMs || 0);
        if (cambiado) cambios.push(archivo.nombreOriginal || archivo.id);
      } catch (error) {
        cambios.push((archivo.nombreOriginal || archivo.id) + ' (inaccesible)');
      }
      return cambios.length >= limiteMostrar;
    });
  });
  if (cambios.length) {
    throw new Error('La última proyección está desactualizada porque cambiaron compilados: ' + cambios.join(' | ') + '. Selecciona todas las carpetas y pulsa nuevamente “1. Proyectar”.');
  }
  cache.put(cacheKey, '1', 300);
}

function obtenerTomosDesdeUltimaProyeccion_(seleccionados, config) {
  var proyeccion = cargarUltimaProyeccionTomos_();
  if (!proyeccion) throw new Error('No existe una proyección completa guardada. Selecciona todas las carpetas que formarán el expediente y pulsa primero “1. Proyectar”.');
  validarUltimaProyeccionVigente_(proyeccion);
  var pdfsManualActual = (config && Array.isArray(config.pdfsManual)) ? config.pdfsManual : [];
  var haySeleccionManual = pdfsManualActual.length > 0;
  var seleccionActual = {};
  (seleccionados || []).forEach(function(item) { if (item && item.id) seleccionActual[String(item.id)] = true; });
  var idsProyectados = {};
  proyeccion.seleccion.forEach(function(item) { if (item && item.id) idsProyectados[String(item.id)] = true; });
  var fueraDeProyeccion = Object.keys(seleccionActual).filter(function(id) { return !idsProyectados[id]; });
  if (fueraDeProyeccion.length) throw new Error('La selección actual contiene carpetas que no pertenecen a la última proyección. Ejecuta nuevamente “1. Proyectar” con todas las carpetas.');
  if (haySeleccionManual) {
    var idsManualProyectados = {};
    (proyeccion.seleccionManual || []).forEach(function(item) { if (item && item.id) idsManualProyectados[String(item.id)] = true; });
    var manualFueraDeProyeccion = pdfsManualActual.filter(function(item) { return item && item.id && !idsManualProyectados[String(item.id)]; });
    if (manualFueraDeProyeccion.length) throw new Error('La selección manual actual contiene PDF que no formaban parte de la última proyección. Ejecuta nuevamente “1. Proyectar” con los mismos PDF marcados.');
  }
  var relacionados = proyeccion.tomos.filter(function(tomo) {
    return (tomo.archivos || []).some(function(archivo) {
      if (seleccionActual[String(archivo.carpetaOrigenId || '')]) return true;
      if (haySeleccionManual && archivo.carpetaOrigenId === ID_SELECCION_MANUAL_TOMOS) return true;
      return false;
    });
  });
  if (!relacionados.length) throw new Error('Las carpetas o los PDF seleccionados no aparecen en la última proyección. Vuelve a proyectar antes de crear índices o fusionar.');
  var tomosSeleccionados = seleccionarTomos_(relacionados, config || {});
  return { tomos: tomosSeleccionados, totalTomos: proyeccion.totalTomos, fechaProyeccion: Number(proyeccion.created) || 0, seleccionProyectada: proyeccion.seleccion };
}

function herramienta1_Calcular(seleccionados, config) {
  var sheet = obtenerHojaSegura(CONFIG_SISTEMA.HOJA_TOMOS);
  var calculo = procesarCalculoMatematico(seleccionados, config);
  if (!calculo.tomos.length) {
    var detalleSinConteo = resumenPdfsOmitidos_(calculo.omitidos, 8);
    throw new Error('No se encontraron PDF con el patrón de páginas en el nombre.' + (detalleSinConteo ? ' Archivos detectados sin conteo: ' + detalleSinConteo + '.' : ''));
  }
  guardarUltimaProyeccion_(seleccionados, calculo, config && config.pdfsManual);
  var numeraciones = resolverNumeracionTomos_(calculo.tomos, calculo.tomos.length, { usarNumeracionManual: false });
  var omitidosOrdenados = ordenarPdfsOmitidos_(calculo.omitidos);
  var filas = [];
  filas.push([new Date(), 'BLOQUE UNIFICADO (' + seleccionados.length + ' carpetas)', '1. PROYECCIÓN', 'Proyección total: ' + calculo.tomos.length + ' tomos', omitidosOrdenados.length ? 'PDF omitidos: ' + omitidosOrdenados.length + ' | Ver detalle debajo' : '']);
  numeraciones.forEach(function(numeracion) {
    var tomo = numeracion.tomo;
    var anexos = [];
    tomo.archivos.forEach(function(archivo) { if (anexos.indexOf(archivo.carpetaOrigen) === -1) anexos.push(archivo.carpetaOrigen); });
    filas.push(['', 'TOMO ' + etiquetaNumeracionTomo_(numeracion), tomo.totalFoleo + ' folios / ' + tomo.totalFisicas + ' páginas físicas finales', tomo.archivos.length + ' archivos', 'Contiene: ' + anexos.join(' | ') + (tomo.excedeLimite ? ' | ⚠️ Supera el límite configurado' : '')]);
  });
  filas = filas.concat(crearFilasPdfsOmitidos_(omitidosOrdenados));
  var inicio = Math.max(15, sheet.getLastRow() + 1);
  sheet.getRange(inicio, 1, filas.length, 5).setValues(filas);
  var excedidos = calculo.tomos.filter(function(tomo) { return tomo.excedeLimite; }).length;
  return {
    status: omitidosOrdenados.length || excedidos ? 'partial' : 'success',
    tomos: calculo.tomos.length,
    omitidos: omitidosOrdenados.length,
    omitidosDetalle: omitidosOrdenados,
    excedidos: excedidos,
    mensaje: '✅ Proyección finalizada: ' + calculo.tomos.length + ' tomos. ' +
      'La numeración automática será ' + formatearNumeroMinimo_(1, Math.max(2, String(calculo.tomos.length).length)) + '/' + formatearNumeroMinimo_(calculo.tomos.length, Math.max(2, String(calculo.tomos.length).length)) +
      ' hasta ' + formatearNumeroMinimo_(calculo.tomos.length, Math.max(2, String(calculo.tomos.length).length)) + '/' + formatearNumeroMinimo_(calculo.tomos.length, Math.max(2, String(calculo.tomos.length).length)) + '. ' +
      (omitidosOrdenados.length ? '⚠️ PDF omitidos sin conteo: ' + omitidosOrdenados.length + '. Se registró el nombre, la carpeta, la ruta, el motivo y el enlace en la hoja TOMOS. Archivos: ' + resumenPdfsOmitidos_(omitidosOrdenados, 6) + '. ' : '') +
      (excedidos ? '⚠️ Tomos que superan el límite por contener un PDF individual muy grande: ' + excedidos + '.' : '')
  };
}

function nombreCaratulaTomo_(numeracion) {
  return 'caratula tomo ' + numeracion.numeroTexto + '.pdf';
}

function herramienta2_Caratulas(seleccionados, config) {
  var nombreHoja = CONFIG_SISTEMA.HOJA_TOMOS;
  var sheet = obtenerHojaSegura(nombreHoja);
  var idPlantilla = obtenerIdDesdeHoja('C3', nombreHoja);
  var idDestino = obtenerIdDesdeHoja('C6', nombreHoja);
  var plantilla = DriveApp.getFileById(idPlantilla);
  if (plantilla.getMimeType() !== MimeType.GOOGLE_DOCS) throw new Error('La plantilla de índices en TOMOS!C3 debe ser un archivo de Google Docs.');
  var operacion = obtenerTomosDesdeUltimaProyeccion_(seleccionados, config || {});
  var tomos = operacion.tomos;
  var numeraciones = resolverNumeracionTomos_(tomos, operacion.totalTomos, config || {});
  var carpetaBase = DriveApp.getFolderById(idDestino);
  var carpetaSalida = getOrCreateFolder(carpetaBase, String(obtenerValorConfigSistema_('CARPETA_INDICES_TOMOS', 'ÍNDICES DE TOMOS')), {});
  var creadas = 0, reemplazadas = 0, errores = [], logs = [];
  var archivosGenerados = []; // 👈 NUEVO
  numeraciones.forEach(function(numeracion) {
    var tomo = numeracion.tomo;
    var nombrePdf = nombreCaratulaTomo_(numeracion);
    var copia = plantilla.makeCopy('TEMP ÍNDICE TOMO ' + numeracion.numeroTexto + ' - ' + Utilities.getUuid().slice(0, 8), carpetaSalida);
    try {
      rellenarIndiceTomo_(copia.getId(), tomo, numeracion);
      var existentesAntes = listarArchivosExactos_(carpetaSalida, nombrePdf).length;
      var blob = exportarGoogleWorkspaceAPdf(copia.getId()).setName(nombrePdf);
      var pdf = crearArchivoSinDuplicados_(carpetaSalida, blob, nombrePdf);
      guardarCaratulaTomoReciente_(numeracion, pdf.getId(), carpetaSalida.getId());
      creadas++;
      if (existentesAntes) reemplazadas++;
      archivosGenerados.push({ // 👈 NUEVO
        origen: 'ÍNDICE TOMO ' + numeracion.numeroTexto,
        id: pdf.getId(),
        url: pdf.getUrl(),
        name: nombrePdf
      });
      logs.push([new Date(), 'Google Apps Script - Índices', nombrePdf, existentesAntes ? '♻️ Índice creado y versión anterior reemplazada' : '✅ Índice de tomo creado', pdf.getUrl(), pdf.getId()]);
    } catch (error) {
      errores.push('Tomo proyectado ' + tomo.numero + ' (' + etiquetaNumeracionTomo_(numeracion) + '): ' + error.message);
      logs.push([new Date(), 'Google Apps Script - Índices', nombrePdf, '❌ Error al generar índice: ' + error.message, '', '']);
    } finally {
      try { copia.setTrashed(true); } catch (errorTrash) {}
    }
  });
  var registrosAgregados = escribirLogsIndicesTomos_(sheet, logs);
  return {
    status: errores.length ? (creadas ? 'partial' : 'error') : 'success',
    creadas: creadas,
    reemplazadas: reemplazadas,
    errores: errores.length,
    detalleErrores: errores,
    carpetaId: carpetaSalida.getId(),
    registrosAgregados: registrosAgregados,
    archivosGenerados: archivosGenerados, // 👈 NUEVO
    mensaje: (errores.length ? '⚠️ Índices generados con observaciones. ' : '✅ Índices generados. ') +
      'Creados: ' + creadas + ' | Total de la proyección: ' + operacion.totalTomos + ' | Versiones anteriores reemplazadas: ' + reemplazadas + ' | Errores: ' + errores.length + ' | Actividades registradas: ' + registrosAgregados
  };
}

function escribirLogsIndicesTomos_(sheet, filas) {
  if (!sheet || !Array.isArray(filas) || !filas.length) return 0;
  try {
    var inicio = Math.max(15, sheet.getLastRow() + 1);
    sheet.getRange(inicio, 1, filas.length, 6).setValues(filas);
    return filas.length;
  } catch (error) {
    console.warn('No se pudieron registrar las actividades de índices: ' + error.message);
    return 0;
  }
}

function rellenarIndiceTomo_(documentId, tomo, numeracion) {
  var doc = DocumentApp.openById(documentId);
  var body = doc.getBody();
  body.setMarginBottom(15);
  body.setMarginTop(20);
  var reemplazos = { '\\bAA\\b': numeracion.numeroTexto, '\\bBB\\b': numeracion.totalTexto, '\\bCCCC\\b': formatearNumeroMinimo_(tomo.totalFoleo, 4) };
  [body, doc.getHeader(), doc.getFooter()].filter(Boolean).forEach(function(seccion) {
    Object.keys(reemplazos).forEach(function(patron) { seccion.replaceText(patron, reemplazos[patron]); });
  });
  var targetTable = null;
  var templateRowIndex = -1;
  var tables = body.getTables();
  for (var i = 0; i < tables.length && !targetTable; i++) {
    for (var r = 0; r < tables[i].getNumRows(); r++) {
      var text = tables[i].getRow(r).getText();
      if (/XX|YYYY|0000-0000/.test(text)) { targetTable = tables[i]; templateRowIndex = r; break; }
    }
  }
  if (!targetTable || templateRowIndex < 0) { doc.saveAndClose(); throw new Error('No se encontró la fila modelo con XX, YYYY y 0000-0000.'); }
  var grupos = consolidarAnexosTomo_(tomo.archivos);
  var templateRow = targetTable.getRow(templateRowIndex).copy();
  for (var g = 0; g < grupos.length; g++) {
    var grupo = grupos[g];
    var nuevaFila = targetTable.insertTableRow(templateRowIndex + g, templateRow.copy());
    var inicio = formatearNumeroMinimo_(grupo.startFoleo, 4);
    var fin = formatearNumeroMinimo_(grupo.endFoleo, 4);
    if (!grupo.numAnexoStr) {
      nuevaFila.replaceText('ANEXO\\s+XX', '');
      nuevaFila.replaceText('Anexo\\s+XX', '');
      nuevaFila.replaceText('anexo\\s+XX', '');
      nuevaFila.replaceText('\\bXX\\b', '');
    } else {
      nuevaFila.replaceText('\\bXX\\b', grupo.numAnexoStr);
    }
    nuevaFila.replaceText('\\bYYYY\\b', grupo.descAnexo || '');
    nuevaFila.replaceText('0000-0000', inicio + '-' + fin);
  }
  targetTable.removeRow(templateRowIndex + grupos.length);
  limpiarParrafosVaciosPosteriores_(body, targetTable);
  doc.saveAndClose();
}

function consolidarAnexosTomo_(archivos) {
  var grupos = [];
  archivos.forEach(function(archivo) {
    var clave = archivo.numAnexoStr + '|' + archivo.descAnexo;
    var ultimo = grupos.length ? grupos[grupos.length - 1] : null;
    if (ultimo && ultimo.clave === clave) ultimo.endFoleo = archivo.endFoleo;
    else grupos.push({ clave: clave, numAnexoStr: archivo.numAnexoStr, descAnexo: archivo.descAnexo, startFoleo: archivo.startFoleo, endFoleo: archivo.endFoleo });
  });
  return grupos;
}

function limpiarParrafosVaciosPosteriores_(body, tabla) {
  var indiceTabla = body.getChildIndex(tabla);
  for (var i = body.getNumChildren() - 1; i > indiceTabla; i--) {
    var child = body.getChild(i);
    if (child.getType() !== DocumentApp.ElementType.PARAGRAPH) break;
    var p = child.asParagraph();
    if (p.getText().trim()) break;
    if (body.getNumChildren() > 1) { try { child.removeFromParent(); } catch (error) { p.clear(); } } else p.clear();
  }
}

function guardarCaratulaTomoReciente_(numeracion, fileId, folderId) {
  var data = { fileId: fileId, folderId: folderId, numeroProyectado: numeracion.numeroProyectado, numeroVisible: numeracion.numeroVisible, totalVisible: numeracion.totalVisible, numeroTexto: numeracion.numeroTexto, totalTexto: numeracion.totalTexto, created: Date.now() };
  PropertiesService.getDocumentProperties().setProperty('CARATULA_TOMO_PROYECTADO_' + numeracion.numeroProyectado, JSON.stringify(data));
}

function carpetaEstaDentroDe_(folderId, rootId) {
  if (!folderId || !rootId) return false;
  if (folderId === rootId) return true;
  var visitados = {};
  var pendientes = [folderId];
  while (pendientes.length) {
    var actualId = pendientes.shift();
    if (visitados[actualId]) continue;
    visitados[actualId] = true;
    try {
      var carpeta = DriveApp.getFolderById(actualId);
      var padres = carpeta.getParents();
      while (padres.hasNext()) {
        var padre = padres.next();
        var padreId = padre.getId();
        if (padreId === rootId) return true;
        if (!visitados[padreId]) pendientes.push(padreId);
      }
    } catch (error) {}
  }
  return false;
}

function buscarCaratulaTomo_(numeracion, idCarpetaBase) {
  var prop = PropertiesService.getDocumentProperties().getProperty('CARATULA_TOMO_PROYECTADO_' + numeracion.numeroProyectado);
  if (prop) {
    var data = parsearJsonSeguro(prop);
    if (data && data.fileId && data.folderId && Number(data.numeroVisible) === Number(numeracion.numeroVisible) && Number(data.totalVisible) === Number(numeracion.totalVisible) && carpetaEstaDentroDe_(data.folderId, idCarpetaBase)) {
      try {
        var guardada = DriveApp.getFileById(data.fileId);
        if (!guardada.isTrashed()) return guardada;
      } catch (errorGuardada) {}
    }
  }
  var nombre = nombreCaratulaTomo_(numeracion);
  var candidatas = [];
  function recorrer(folder) {
    var files = folder.getFilesByName(nombre);
    while (files.hasNext()) { var file = files.next(); if (!file.isTrashed()) candidatas.push(file); }
    var subs = folder.getFolders();
    while (subs.hasNext()) recorrer(subs.next());
  }
  recorrer(DriveApp.getFolderById(idCarpetaBase));
  candidatas.sort(function(a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  return candidatas.length ? candidatas[0] : null;
}

function buscarTomoFinalReciente_(carpeta, nombreArchivo, fechaInicio) {
  var candidatos = [];
  var archivos = carpeta.getFilesByName(nombreArchivo);
  var minimo = fechaInicio ? fechaInicio.getTime() - 5000 : 0;
  while (archivos.hasNext()) {
    var file = archivos.next();
    if (!file.isTrashed() && file.getDateCreated().getTime() >= minimo) candidatos.push(file);
  }
  candidatos.sort(function(a, b) { return b.getDateCreated().getTime() - a.getDateCreated().getTime(); });
  if (!candidatos.length) return null;
  var encontrado = candidatos[0];
  return { id: encontrado.getId(), url: encontrado.getUrl(), final_name: encontrado.getName(), paginas: 0 };
}

function recuperarTomoTrasError_(carpeta, nombreArchivo, fechaInicio) {
  var intentos = 3;
  for (var i = 0; i < intentos; i++) {
    var encontrado = buscarTomoFinalReciente_(carpeta, nombreArchivo, fechaInicio);
    if (encontrado) return encontrado;
    if (i < intentos - 1) Utilities.sleep(2000);
  }
  return null;
}

function obtenerBaseServidorTomos_(endpoint) {
  return String(endpoint || '').trim().replace(/\/tomos\/?$/i, '').replace(/\/+$/, '');
}

function construirDetalleHttpTomos_(code, data, text) {
  var detalle = '';
  if (data && data.detail) detalle = String(data.detail);
  else if (data && data.message) detalle = String(data.message);
  else if (text) detalle = String(text).substring(0, 300);
  else detalle = 'Respuesta vacía';
  return 'HTTP ' + code + ': ' + detalle;
}

function registrarResultadoTomo_(data, ref, carpetaSalida, logs, recuperado, archivosGenerados) {
  var id = data && data.id ? String(data.id) : '';
  var nombre = data && data.final_name ? String(data.final_name) : ref.nombreSalida;
  var paginas = Number(data && data.paginas) || 0;
  var esperadas = Number(ref.paginasEsperadas) || 0;
  if (esperadas && paginas && paginas !== esperadas) {
    if (id) enviarArchivosPapeleraPorId_([id], []);
    logs.push([new Date(), 'TOMO ' + etiquetaNumeracionTomo_(ref.numeracion), 'Error de integridad', '❌ Se esperaban ' + esperadas + ' páginas, pero Colab generó ' + paginas + '.', '', '']);
    ref.ultimoError = 'Cantidad de páginas distinta a la proyección.';
    return false;
  }
  if (!id && !recuperado) return false;
  if (id) eliminarDuplicadosNombreExcepto_(carpetaSalida, nombre, id);
  var mensaje = recuperado ? '✅ Tomo encontrado en Drive después de una interrupción de conexión' : '✅ Tomo ensamblado por Colab';
  if (data && data.status === 'partial') mensaje += ' | ⚠️ Algunos archivos no pudieron incorporarse';
  logs.push([new Date(), 'TOMO ' + etiquetaNumeracionTomo_(ref.numeracion), nombre, mensaje + ' (' + (paginas || esperadas || ref.tomo.totalFisicas) + ' páginas físicas)', data && data.url ? data.url : '', id]);

  if (archivosGenerados && id) { // 👈 NUEVO
    archivosGenerados.push({
      origen: 'TOMO ' + etiquetaNumeracionTomo_(ref.numeracion),
      id: id,
      url: data && data.url ? data.url : '',
      name: nombre
    });
  }

  return true;
}

function herramienta3_GenerarTomos(seleccionados, config) {
  var nombreHoja = CONFIG_SISTEMA.HOJA_TOMOS;
  var sheet = obtenerHojaSegura(nombreHoja);
  var idDestinoTomos = obtenerIdDesdeHoja('C4', nombreHoja);
  var idDestinoCaratulas = obtenerIdDesdeHoja('C6', nombreHoja);
  var endpoint = normalizarUrlEndpoint(sheet.getRange('C8').getDisplayValue(), 'tomos');
  var baseServidor = obtenerBaseServidorTomos_(endpoint);
  var operacion = obtenerTomosDesdeUltimaProyeccion_(seleccionados, config || {});
  var tomos = operacion.tomos;
  var numeraciones = resolverNumeracionTomos_(tomos, operacion.totalTomos, config || {});
  var permitirSinCaratula = Boolean(config && config.permitirSinCaratula);
  var estricto = Boolean(obtenerValorConfigSistema_('MODO_ESTRICTO_TOMOS', true));
  var preparados = [];
  var omitidos = 0;
  numeraciones.forEach(function(numeracion) {
    var caratula = buscarCaratulaTomo_(numeracion, idDestinoCaratulas);
    if (!caratula && !permitirSinCaratula) { omitidos++; return; }
    preparados.push({ tomo: numeracion.tomo, numeracion: numeracion, caratula: caratula });
  });
  if (!preparados.length) {
    return { status: 'error', exitosos: 0, pendientes: 0, omitidos: omitidos, errores: 0, archivosGenerados: [], mensaje: 'No se envió ningún tomo. Faltan las carátulas requeridas en TOMOS!C6.' };
  }
  var carpetaBase = DriveApp.getFolderById(idDestinoTomos);
  var carpetaSalida = getOrCreateFolder(carpetaBase, String(obtenerValorConfigSistema_('CARPETA_TOMOS_FINALES', 'TOMOS FINALES')), {});
  var token = ScriptApp.getOAuthToken();
  var solicitudes = [];
  var referencias = [];
  preparados.forEach(function(item) {
    var carpetasOrigen = item.tomo.archivos.map(function(a) { return a.carpetaOrigen; });
    var carpetasUnicas = [];
    carpetasOrigen.forEach(function(c) { if (carpetasUnicas.indexOf(c) === -1) carpetasUnicas.push(c); });
    var resumenCarpetas = carpetasUnicas.join('_').replace(/[\\/:*?"<>|]/g, '-').substring(0, 80) || 'GENERAL';
    var fechaMarca = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    var nombreSalida = 'TOMO ' + item.numeracion.numeroTexto + '_' + resumenCarpetas + '_' + fechaMarca + '.pdf';
    var fechaInicio = new Date();
    var requestId = Utilities.getUuid();
    var paginasEsperadas = item.tomo.totalContenido + (item.caratula ? 1 : 0);
    var sourceCount = item.tomo.archivos.length + (item.caratula ? 1 : 0);
    solicitudes.push({
      url: endpoint,
      method: 'post',
      contentType: 'application/json',
      headers: obtenerHeadersServidor_(token),
      payload: JSON.stringify({
        request_id: requestId,
        modo_async: true,
        strict_mode: estricto,
        replace_existing: false,
        expected_pages: paginasEsperadas,
        expected_source_count: sourceCount,
        caratula_id: item.caratula ? item.caratula.getId() : '',
        file_ids: item.tomo.archivos.map(function(archivo) { return archivo.id; }),
        destination_folder_id: carpetaSalida.getId(),
        output_filename: nombreSalida
      }),
      muteHttpExceptions: true
    });
    referencias.push({
      tomo: { totalFisicas: item.tomo.totalFisicas },
      numeracion: {
        numeroProyectado: item.numeracion.numeroProyectado,
        numeroVisible: item.numeracion.numeroVisible,
        totalVisible: item.numeracion.totalVisible,
        numeroTexto: item.numeracion.numeroTexto,
        totalTexto: item.numeracion.totalTexto,
        manual: item.numeracion.manual
      },
      nombreSalida: nombreSalida,
      fechaInicioMs: fechaInicio.getTime(),
      paginasEsperadas: paginasEsperadas,
      requestId: requestId,
      ultimoError: '',
      intentos: 0
    });
  });
  var respuestas = ejecutarFetchAllPorBloques_(solicitudes, Number(obtenerValorConfigSistema_('PETICIONES_PARALELAS', 2)));
  var pendientes = [], sinConfirmacion = [], logs = [], exitosos = 0, errores = 0;
  var archivosGenerados = []; // 👈 NUEVO
  for (var i = 0; i < referencias.length; i++) {
    var ref = referencias[i];
    var response = respuestas[i] || null;
    var code = response ? response.getResponseCode() : 0;
    var text = response ? response.getContentText() : '';
    var data = response ? parsearJsonSeguro(text) : null;
    if ((code === 200 || code === 202) && data && data.job_id) {
      pendientes.push({ jobId: String(data.job_id), ref: ref });
      continue;
    }
    if (code >= 200 && code < 300 && data && (data.status === 'success' || data.status === 'partial')) {
      if (registrarResultadoTomo_(data, ref, carpetaSalida, logs, false, archivosGenerados)) exitosos++;
      else errores++;
      continue;
    }
    ref.ultimoError = construirDetalleHttpTomos_(code, data, text);
    sinConfirmacion.push(ref);
  }
  if (logs.length) {
    var inicio = Math.max(15, sheet.getLastRow() + 1);
    sheet.getRange(inicio, 1, logs.length, 6).setValues(logs);
  }
  guardarPendientesTomos_(baseServidor, carpetaSalida.getId(), pendientes, sinConfirmacion);
  var restantes = pendientes.length + sinConfirmacion.length;
  return {
    status: restantes ? 'pending' : (errores ? (exitosos ? 'partial' : 'error') : 'success'),
    exitosos: exitosos,
    pendientes: restantes,
    omitidos: omitidos,
    errores: errores,
    archivosGenerados: archivosGenerados, // 👈 NUEVO
    mensaje: '✅ Tomos enviados. Confirmados inmediatamente: ' + exitosos + ' | Pendientes: ' + restantes + ' | Omitidos: ' + omitidos + ' | Errores: ' + errores + '. ' + (restantes ? 'Usa “Consultar pendientes” para actualizar el resultado.' : '')
  };
}

// ====================================================================
// ⏳ CONSULTA REANUDABLE DE TOMOS
// ====================================================================
var CLAVE_PENDIENTES_TOMOS_ = 'PENDIENTES_TOMOS_V3';

function guardarPendientesTomos_(baseServidor, carpetaSalidaId, pendientes, sinConfirmacion) {
  var anterior = leerEstadoJsonFragmentado_(CLAVE_PENDIENTES_TOMOS_) || {};
  var jobs = (anterior.pendientes || []).concat(pendientes || []);
  var inciertos = (anterior.sinConfirmacion || []).concat(sinConfirmacion || []);
  var vistos = {};
  jobs = jobs.filter(function(item) {
    var clave = String(item.jobId || '') + '|' + String(item.ref && item.ref.requestId || '');
    if (!clave || vistos[clave]) return false;
    vistos[clave] = true;
    return true;
  });
  inciertos = inciertos.filter(function(ref) {
    var clave = 'S|' + String(ref && ref.requestId || '');
    if (!ref || !ref.requestId || vistos[clave]) return false;
    vistos[clave] = true;
    return true;
  });
  if (!jobs.length && !inciertos.length) {
    eliminarEstadoJsonFragmentado_(CLAVE_PENDIENTES_TOMOS_);
    return;
  }
  guardarEstadoJsonFragmentado_(CLAVE_PENDIENTES_TOMOS_, {
    version: 3,
    baseServidor: baseServidor,
    carpetaSalidaId: carpetaSalidaId || anterior.carpetaSalidaId || '',
    actualizado: Date.now(),
    pendientes: jobs,
    sinConfirmacion: inciertos
  });
}

function consultarTomosPendientes() {
  var estado = leerEstadoJsonFragmentado_(CLAVE_PENDIENTES_TOMOS_);
  if (!estado || (!(estado.pendientes || []).length && !(estado.sinConfirmacion || []).length)) {
    return { status: 'success', exitosos: 0, pendientes: 0, errores: 0, archivosGenerados: [], mensaje: 'No existen tomos pendientes.' };
  }
  var sheet = obtenerHojaSegura(CONFIG_SISTEMA.HOJA_TOMOS);
  var endpoint = normalizarUrlEndpoint(sheet.getRange('C8').getDisplayValue(), 'tomos');
  var baseServidor = obtenerBaseServidorTomos_(endpoint);
  var token = ScriptApp.getOAuthToken();
  var carpetaSalida = DriveApp.getFolderById(estado.carpetaSalidaId);
  var pendientes = estado.pendientes || [];
  var inciertos = estado.sinConfirmacion || [];
  var siguientes = [], siguientesInciertos = [], logs = [], exitosos = 0, errores = 0;
  var archivosGenerados = []; // 👈 NUEVO
  var consultas = pendientes.map(function(item) {
    return { url: baseServidor + '/trabajos/' + encodeURIComponent(item.jobId), method: 'get', headers: obtenerHeadersServidor_(token), muteHttpExceptions: true };
  });
  var respuestas = ejecutarFetchAllPorBloques_(consultas, Math.max(1, Number(obtenerValorConfigSistema_('PETICIONES_PARALELAS', 2)) * 2));
  pendientes.forEach(function(item, indice) {
    var ref = item.ref;
    var response = respuestas[indice] || null;
    var code = response ? response.getResponseCode() : 0;
    var text = response ? response.getContentText() : '';
    var data = response ? parsearJsonSeguro(text) : null;
    if (code === 200 && data && (data.job_state === 'queued' || data.job_state === 'running' || data.status === 'accepted' || data.status === 'running')) {
      siguientes.push(item); return;
    }
    if (code === 200 && data && (data.status === 'success' || data.status === 'partial') && data.id) {
      if (registrarResultadoTomo_(data, ref, carpetaSalida, logs, false, archivosGenerados)) exitosos++;
      else errores++;
      return;
    }
    var recuperado = buscarTomoFinalReciente_(carpetaSalida, ref.nombreSalida, new Date(ref.fechaInicioMs));
    if (recuperado) {
      recuperado.paginas = ref.paginasEsperadas;
      if (registrarResultadoTomo_(recuperado, ref, carpetaSalida, logs, true, archivosGenerados)) exitosos++;
      else errores++;
    } else if (data && (data.job_state === 'failed' || data.status === 'error')) {
      errores++;
      logs.push([new Date(), 'TOMO ' + etiquetaNumeracionTomo_(ref.numeracion), 'Error en ejecución', '❌ ' + (data.detail || data.message || 'El trabajo falló.'), '', '']);
    } else {
      ref.intentos = Number(ref.intentos || 0) + 1;
      ref.ultimoError = construirDetalleHttpTomos_(code, data, text);
      if (ref.intentos >= 6) {
        errores++;
        logs.push([new Date(), 'TOMO ' + etiquetaNumeracionTomo_(ref.numeracion), 'Sin confirmación', '❌ ' + ref.ultimoError, '', '']);
      } else siguientes.push(item);
    }
  });
  inciertos.forEach(function(ref) {
    var recuperado = buscarTomoFinalReciente_(carpetaSalida, ref.nombreSalida, new Date(ref.fechaInicioMs));
    if (recuperado) {
      recuperado.paginas = ref.paginasEsperadas;
      if (registrarResultadoTomo_(recuperado, ref, carpetaSalida, logs, true, archivosGenerados)) exitosos++;
      else errores++;
    } else {
      ref.intentos = Number(ref.intentos || 0) + 1;
      if (ref.intentos >= 6) {
        errores++;
        logs.push([new Date(), 'TOMO ' + etiquetaNumeracionTomo_(ref.numeracion), 'Error de conexión', '❌ No se confirmó el trabajo ni se encontró el PDF en Drive. ' + (ref.ultimoError || ''), '', '']);
      } else siguientesInciertos.push(ref);
    }
  });
  if (logs.length) {
    var inicio = Math.max(15, sheet.getLastRow() + 1);
    sheet.getRange(inicio, 1, logs.length, 6).setValues(logs);
  }
  eliminarEstadoJsonFragmentado_(CLAVE_PENDIENTES_TOMOS_);
  guardarPendientesTomos_(baseServidor, carpetaSalida.getId(), siguientes, siguientesInciertos);
  var restantes = siguientes.length + siguientesInciertos.length;
  return {
    status: restantes ? 'pending' : (errores ? (exitosos ? 'partial' : 'error') : 'success'),
    exitosos: exitosos,
    pendientes: restantes,
    errores: errores,
    archivosGenerados: archivosGenerados, // 👈 NUEVO
    mensaje: 'Consulta terminada. Tomos confirmados: ' + exitosos + ' | Pendientes: ' + restantes + ' | Errores: ' + errores + '.'
  };
}
