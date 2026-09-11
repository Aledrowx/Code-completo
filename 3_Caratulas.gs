// ====================================================================

// 📄 MÓDULO 1: GENERACIÓN Y RESTAURACIÓN DE CARÁTULAS

// ====================================================================



function obtenerModelosDeCaratula(nombreHoja) {

  var hoja = nombreHoja || CONFIG_SISTEMA.HOJA_COMPILADOS;

  var id = extraerIdDeCeldaSegura(hoja, 'C3');



  if (!id) return [{ id: '', name: '⚠️ Enlace inválido o vacío en C3' }];



  try {

    var carpeta = DriveApp.getFolderById(id);

    var archivos = carpeta.getFiles();

    var modelos = [];



    while (archivos.hasNext()) {

      var archivo = archivos.next();

      if (esMimePlantillaValido(archivo.getMimeType())) {

        modelos.push({ id: archivo.getId(), name: archivo.getName() });

      }

    }



    modelos.sort(function(a, b) {

      return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });

    });



    return modelos.length ? modelos : [{ id: '', name: '⚠️ La carpeta no contiene Google Docs ni Google Slides' }];

  } catch (errorCarpeta) {

    try {

      var archivoDirecto = DriveApp.getFileById(id);

      if (!esMimePlantillaValido(archivoDirecto.getMimeType())) {

        return [{ id: '', name: '⚠️ C3 no apunta a un Google Docs o Google Slides' }];

      }

      return [{ id: archivoDirecto.getId(), name: archivoDirecto.getName() }];

    } catch (errorArchivo) {

      return [{ id: '', name: '⚠️ No se pudo leer C3: ' + errorArchivo.message }];

    }

  }

}



// ====================================================================
// ♻️ BIBLIOTECA CENTRAL DE CARÁTULAS
// ====================================================================
// C4 es la biblioteca única de carátulas. Se indexan los PDFs una sola
// vez por ejecución. Si otro usuario ya generó una carátula, se reutiliza
// el mismo archivo y no se crea otra carpeta/copia.
// ====================================================================
function construirIndiceCaratulasCompartidas_(carpetaRaiz) {
  var indice = {};
  function recorrer(folder) {
    var archivos = folder.getFilesByType(MimeType.PDF);
    while (archivos.hasNext()) {
      var archivo = archivos.next();
      var clave = normalizarTexto(String(archivo.getName() || '').trim());
      if (clave && !indice[clave]) indice[clave] = archivo;
    }
    var subcarpetas = folder.getFolders();
    while (subcarpetas.hasNext()) recorrer(subcarpetas.next());
  }
  recorrer(carpetaRaiz);
  return indice;
}

function obtenerCaratulaCompartidaPorNombre_(indice, nombreArchivo) {
  var clave = normalizarTexto(String(nombreArchivo || '').trim());
  return clave && indice ? (indice[clave] || null) : null;
}

function procesarSeleccionados(lote, configUbicacion, configCaratula) {

  if (!Array.isArray(lote) || !lote.length) {
    throw new Error('No se recibieron carpetas para procesar.');
  }

  var nombreHoja = CONFIG_SISTEMA.HOJA_COMPILADOS;
  var idOrigen = obtenerIdDesdeHoja('C2', nombreHoja);
  var idDestino = obtenerIdDesdeHoja('C4', nombreHoja);
  var ubicacion = configUbicacion || {};
  var caratula = configCaratula || {};
  var soloCarpetas = Boolean(ubicacion.soloCarpetas);
  var tipo = caratula.tipo === 'nueva' ? 'nueva' : 'original';
  var archivoPlantilla = null;

  if (!soloCarpetas) {
    var idPlantilla = caratula.idPlantilla || extraerIdDeCeldaSegura(nombreHoja, 'C3');
    archivoPlantilla = obtenerArchivoPlantillaDesdeId(idPlantilla);
  }

  var destinoRaiz = DriveApp.getFolderById(idDestino);
  var idBiblioteca = obtenerIdBibliotecaCaratulas_(nombreHoja);
  var carpetaBiblioteca = DriveApp.getFolderById(idBiblioteca);
  var indiceCaratulasCompartidas = soloCarpetas ? {} : construirIndiceCaratulasCompartidas_(carpetaBiblioteca);
  var cacheCarpetas = {};
  var logs = [];
  var resultado = {
    status: 'success',
    procesados: 0,
    carpetasPreparadas: 0,
    pdfsCreados: 0,
    omitidos: 0,
    errores: [],
    registrosAgregados: 0,
    archivosGenerados: []
  };

  // ================================================================
  // NUEVO: se procesa TODO el árbol de cada carpeta seleccionada.
  // La carpeta seleccionada sigue siendo la raíz, pero ahora también
  // se recorren todas sus subcarpetas en profundidad.
  // ================================================================
  lote.forEach(function(item) {
    if (!item || !item.id || !item.name) {
      resultado.procesados++;
      resultado.errores.push({ item: 'Sin nombre', detalle: 'Elemento seleccionado incompleto.' });
      return;
    }

    try {
      var raiz = DriveApp.getFolderById(item.id);
      procesarArbolCaratulas_(
        raiz,
        idOrigen,
        destinoRaiz,
        ubicacion,
        caratula,
        archivoPlantilla,
        tipo,
        soloCarpetas,
        indiceCaratulasCompartidas,
        cacheCarpetas,
        logs,
        resultado,
        true
      );
      resultado.procesados++;
    } catch (errorRaiz) {
      resultado.procesados++;
      resultado.errores.push({ item: item.name, detalle: errorRaiz.message });
      logs.push(crearFilaActividadCaratulas_(
        'Google Apps Script - Carátulas',
        item.name,
        '❌ Error al recorrer árbol: ' + errorRaiz.message,
        '',
        ''
      ));
    }
  });

  resultado.registrosAgregados = escribirLogsCaratulas_(nombreHoja, logs);

  if (resultado.errores.length) {
    resultado.status = resultado.pdfsCreados || resultado.carpetasPreparadas
      ? 'partial'
      : 'error';
  }

  resultado.mensaje = construirMensajeCaratulas_(resultado);
  return resultado;
}

// ====================================================================
// 🌳 PROCESAMIENTO RECURSIVO REAL DE CARÁTULAS
// ====================================================================
function procesarArbolCaratulas_(
  folder,
  idOrigen,
  destinoRaiz,
  ubicacion,
  caratula,
  archivoPlantilla,
  tipo,
  soloCarpetas,
  indiceCaratulasCompartidas,
  cacheCarpetas,
  logs,
  resultado,
  esRaizSeleccionada
) {

  var nombre = String(folder.getName() || '').trim();
  if (!nombre) return;

  // 1) Mantener exactamente la estructura del origen en destino.
  var carpetaGuardar = destinoRaiz;
  var ruta = obtenerRutaDesdeOrigen(folder.getId(), idOrigen);

  if (ubicacion.tipo === 'automatico') {
    for (var r = 0; r < ruta.length; r++) {
      carpetaGuardar = getOrCreateFolder(carpetaGuardar, ruta[r], cacheCarpetas);
    }
    carpetaGuardar = getOrCreateFolder(carpetaGuardar, nombre, cacheCarpetas);
  } else {
    var nombreManual = String(ubicacion.nombreNuevaCarpeta || '').trim();
    if (nombreManual) {
      carpetaGuardar = getOrCreateFolder(
        carpetaGuardar,
        sanitizarNombreArchivo(nombreManual.toUpperCase()),
        cacheCarpetas
      );
      // Dentro del destino manual se replica el árbol desde la carpeta
      // seleccionada hacia abajo.
      var rutaRelativa = construirRutaRelativaAlSeleccionado_(folder, esRaizSeleccionada);
      for (var m = 0; m < rutaRelativa.length; m++) {
        carpetaGuardar = getOrCreateFolder(carpetaGuardar, rutaRelativa[m], cacheCarpetas);
      }
    }
  }

  resultado.carpetasPreparadas++;

  if (!soloCarpetas) {
    var filenameFinal = sanitizarNombreArchivo(nombre.toUpperCase()) + '.PDF';

    // 2) Primero reutilizar la carátula central si ya existe.
    var caratulaCompartida = encontrarCaratulaCompartidaFlexible_(
      indiceCaratulasCompartidas,
      nombre
    );

    if (caratulaCompartida) {
      resultado.omitidos++;
      resultado.archivosGenerados.push({
        origen: nombre,
        id: caratulaCompartida.getId(),
        url: caratulaCompartida.getUrl(),
        name: caratulaCompartida.getName()
      });

      logs.push(crearFilaActividadCaratulas_(
        'Google Apps Script - Carátulas',
        caratulaCompartida.getName(),
        '♻️ Carátula central reutilizada: ' + nombre,
        caratulaCompartida.getUrl(),
        caratulaCompartida.getId()
      ));
    } else {
      // 3) Si no existe en la biblioteca, la generamos una sola vez en C9.
      var carpetaGeneradas = getOrCreateFolder(
        carpetaBibliotecaParaGenerar_(caratula),
        'CARATULAS GENERADAS AUTOMATICAMENTE',
        cacheCarpetas
      );

      var existentesGeneradas = carpetaGeneradas.getFilesByName(filenameFinal);
      var pdfCreado = null;

      if (existentesGeneradas.hasNext()) {
        var existente = existentesGeneradas.next();
        pdfCreado = {
          id: existente.getId(),
          url: existente.getUrl(),
          name: existente.getName()
        };
        resultado.omitidos++;
      } else if (archivoPlantilla) {
        var textoVisual = obtenerTextoVisual(nombre);
        var prefijo = extraerPrefijoAvanzado(nombre);
        var textoLimpio = limpiarTextoSinPrefijoAvanzado(nombre);

        // Mantiene las reglas especiales que ya tenía tu versión.
        var rutaNorm = ruta.map(function(x) { return normalizarTexto(x); });
        var anexoEspecial = rutaNorm.some(function(x) {
          return x.indexOf('anexo 11') !== -1 || x.indexOf('anexo 13') !== -1;
        });

        if (anexoEspecial && ruta.length === 1 && textoLimpio.length >= 9) {
          textoLimpio = textoLimpio.slice(-9);
        } else if (anexoEspecial && ruta.length === 2 && textoLimpio.length > 3) {
          textoLimpio = textoLimpio.substring(3).trim();
        }

        pdfCreado = crearPDFDesdePlantilla_(
          archivoPlantilla,
          textoLimpio,
          prefijo,
          textoVisual,
          filenameFinal,
          carpetaGeneradas,
          tipo
        );
        resultado.pdfsCreados++;

        logs.push(crearFilaActividadCaratulas_(
          'Google Apps Script - Carátulas',
          pdfCreado.name || filenameFinal,
          '✅ Carátula generada y guardada en C9: ' + nombre,
          pdfCreado.url,
          pdfCreado.id
        ));
      }

      if (pdfCreado) {
        indiceCaratulasCompartidas[normalizarTexto(pdfCreado.name)] = DriveApp.getFileById(pdfCreado.id);
        resultado.archivosGenerados.push({
          origen: nombre,
          id: pdfCreado.id,
          url: pdfCreado.url,
          name: pdfCreado.name
        });
      }
    }
  }

  // 4) Recorrer todas las subcarpetas en su orden numérico natural.
  var subcarpetas = [];
  var it = folder.getFolders();
  while (it.hasNext()) subcarpetas.push(it.next());
  subcarpetas.sort(compararCarpetaCaratulaRecursiva_);

  subcarpetas.forEach(function(sub) {
    procesarArbolCaratulas_(
      sub,
      idOrigen,
      destinoRaiz,
      ubicacion,
      caratula,
      archivoPlantilla,
      tipo,
      soloCarpetas,
      indiceCaratulasCompartidas,
      cacheCarpetas,
      logs,
      resultado,
      false
    );
  });
}

function carpetaBibliotecaParaGenerar_(configCaratula) {
  var nombreHoja = CONFIG_SISTEMA.HOJA_COMPILADOS;
  var idBiblioteca = obtenerIdBibliotecaCaratulas_(nombreHoja);
  return DriveApp.getFolderById(idBiblioteca);
}

function extraerNumeroCaratulaRecursiva_(nombre) {
  var texto = String(nombre || '').trim();
  var m = texto.match(/^(?:0*)(\d+(?:\.\d+)*)\s*(?:[.\-_:)]+)?/);
  if (!m) return null;
  return m[1].split('.').map(function(v) { return Number(v); });
}

function compararCarpetaCaratulaRecursiva_(a, b) {
  var na = extraerNumeroCaratulaRecursiva_(a.getName());
  var nb = extraerNumeroCaratulaRecursiva_(b.getName());

  if (na && nb) {
    var len = Math.max(na.length, nb.length);
    for (var i = 0; i < len; i++) {
      var va = na[i] === undefined ? -1 : na[i];
      var vb = nb[i] === undefined ? -1 : nb[i];
      if (va !== vb) return va - vb;
    }
  } else if (na && !nb) {
    return -1;
  } else if (!na && nb) {
    return 1;
  }

  return a.getName().localeCompare(b.getName(), 'es', {
    numeric: true,
    sensitivity: 'base'
  });
}

function construirRutaRelativaAlSeleccionado_(folder, esRaiz) {
  if (esRaiz) return [];
  var salida = [];
  var actual = folder;
  var seguridad = 0;

  while (seguridad++ < 100) {
    var padres = actual.getParents();
    if (!padres.hasNext()) break;
    var padre = padres.next();
    if (!padre) break;
    salida.unshift(actual.getName());
    actual = padre;
    if (normalizarTexto(actual.getName()) === '') break;
  }

  if (salida.length) salida.pop();
  return salida;
}

// Índice compatible con la biblioteca de C9, pero con coincidencia flexible.
function encontrarCaratulaCompartidaFlexible_(indice, nombreCarpeta) {
  if (!indice || !nombreCarpeta) return null;

  var objetivo = normalizarTexto(nombreCarpeta);
  var exacta = indice[objetivo + '.pdf'] || indice[objetivo + ' pdf'];
  if (exacta) return exacta;

  var claveObjetivo = claveNombreCaratula_(nombreCarpeta);
  var mejor = null;
  var mejorPuntaje = 0;

  Object.keys(indice).forEach(function(clave) {
    var archivo = indice[clave];
    var nombre = archivo.getName();
    var claveArchivo = claveNombreCaratula_(nombre);
    var puntaje = puntuarNombreCaratula_(claveObjetivo, claveArchivo);
    if (puntaje > mejorPuntaje) {
      mejorPuntaje = puntaje;
      mejor = archivo;
    }
  });

  return mejorPuntaje >= 60 ? mejor : null;
}

function claveNombreCaratula_(nombre) {
  var s = normalizarTexto(String(nombre || ''))
    .replace(/\.(pdf|docx?|pptx?)$/i, '')
    .replace(/^\d+(?:\.\d+)*[\s._:-]*/,'')
    .replace(/\b(caratula|caratulas|cover|portada)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return s;
}

function puntuarNombreCaratula_(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.indexOf(b) !== -1 || b.indexOf(a) !== -1) return 90;

  var wa = a.split(/\s+/).filter(Boolean);
  var wb = b.split(/\s+/).filter(Boolean);
  var comunes = 0;
  wa.forEach(function(x) {
    if (x.length >= 3 && wb.indexOf(x) !== -1) comunes++;
  });

  if (!wa.length) return 0;
  return (comunes / Math.max(wa.length, wb.length)) * 100;
}




function construirMensajeCaratulas_(resultado) {

  var partes = [

    'Carpetas procesadas: ' + resultado.procesados,

    'PDF creados: ' + resultado.pdfsCreados,

    'Omitidos por existir: ' + resultado.omitidos,

    'Actividades registradas: ' + Number(resultado.registrosAgregados || 0)

  ];



  if (resultado.errores.length) {

    partes.push('Errores: ' + resultado.errores.length);

  }



  return (

    resultado.errores.length

      ? '⚠️ Proceso completado con observaciones. '

      : '✅ Proceso completado. '

  ) + partes.join(' | ');

}



function crearFilaActividadCaratulas_(

  origen,

  archivo,

  estado,

  url,

  id

) {

  return [

    new Date(),

    String(origen || 'Google Apps Script - Carátulas'),

    String(archivo || ''),

    String(estado || ''),

    String(url || ''),

    String(id || '')

  ];

}



function escribirLogsCaratulas_(nombreHoja, filas) {

  if (!Array.isArray(filas) || !filas.length) return 0;



  try {

    var sheet = obtenerHojaSegura(nombreHoja);

    var inicio = Math.max(15, sheet.getLastRow() + 1);



    sheet.getRange(

      inicio,

      1,

      filas.length,

      6

    ).setValues(filas);



    return filas.length;

  } catch (error) {

    console.warn(

      'No se pudieron registrar las actividades de carátulas: ' +

      error.message

    );

    return 0;

  }

}



function crearPDFDesdePlantilla_(

  archivoPlantilla,

  textoLimpio,

  prefijo,

  textoVisual,

  filenameFinal,

  carpetaDestino,

  tipoCaratula

) {

  var textoMayus = String(textoLimpio || '').toUpperCase().trim();

  var visualMayus = String(textoVisual || '').toUpperCase().trim();

  var prefijoMayus = String(prefijo || '').toUpperCase().trim();



  var temporal = archivoPlantilla.makeCopy(

    'TEMP_' + Utilities.getUuid().slice(0, 8) + '_' + filenameFinal,

    carpetaDestino

  );



  try {

    var mime = archivoPlantilla.getMimeType();

    var valores = tipoCaratula === 'nueva'

      ? {

          YYYY: prefijoMayus,

          XXXXXX: textoMayus,

          XXXXX: textoMayus,

          XXXX: textoMayus

        }

      : {

          XXXXXX: visualMayus,

          XXXXX: visualMayus,

          XXXX: visualMayus

        };



    if (mime === MimeType.GOOGLE_SLIDES) {

      editarPlantillaSlides_(

        temporal.getId(),

        valores,

        [textoMayus, visualMayus, prefijoMayus]

      );

    } else if (mime === MimeType.GOOGLE_DOCS) {

      editarPlantillaDocs_(

        temporal.getId(),

        valores,

        [textoMayus, visualMayus, prefijoMayus]

      );

    } else {

      throw new Error(

        'La plantilla debe ser Google Docs o Google Slides.'

      );

    }



    var pdfBlob = exportarGoogleWorkspaceAPdf(temporal.getId());

    pdfBlob.setName(filenameFinal);



    // Crea la versión nueva y conserva un solo PDF activo con ese nombre.

    var archivoCreado = crearArchivoSinDuplicados_(

      carpetaDestino,

      pdfBlob,

      filenameFinal

    );



    return {

      id: archivoCreado.getId(),

      url: archivoCreado.getUrl(),

      name: archivoCreado.getName()

    };



  } finally {

    try {

      temporal.setTrashed(true);

    } catch (errorTrash) {

      console.warn(

        'No se pudo enviar a la papelera el temporal ' +

        temporal.getId() + ': ' + errorTrash.message

      );

    }

  }

}



function editarPlantillaSlides_(fileId, valores, textosInsertados) {

  var presentacion = SlidesApp.openById(fileId);



  Object.keys(valores).forEach(function(marcador) {

    presentacion.replaceAllText(marcador, valores[marcador] || '');

  });



  var buscados = textosInsertados.filter(function(texto) { return Boolean(texto); });

  var slides = presentacion.getSlides();



  for (var i = 0; i < slides.length; i++) {

    var elementos = slides[i].getPageElements();



    for (var j = 0; j < elementos.length; j++) {

      try {

        if (elementos[j].getPageElementType() === SlidesApp.PageElementType.SHAPE) {

          centrarTextRangeSlidesSiCoincide_(elementos[j].asShape().getText(), buscados);

        } else if (elementos[j].getPageElementType() === SlidesApp.PageElementType.TABLE) {

          var tabla = elementos[j].asTable();

          for (var r = 0; r < tabla.getNumRows(); r++) {

            for (var c = 0; c < tabla.getNumColumns(); c++) {

              centrarTextRangeSlidesSiCoincide_(tabla.getCell(r, c).getText(), buscados);

            }

          }

        }

      } catch (errorElemento) {

        console.warn('Elemento de Slides omitido: ' + errorElemento.message);

      }

    }

  }



  presentacion.saveAndClose();

}



function centrarTextRangeSlidesSiCoincide_(textRange, buscados) {

  var contenido = textRange.asString();

  var coincide = buscados.some(function(texto) { return contenido.indexOf(texto) !== -1; });

  if (!coincide) return;



  var parrafos = textRange.getParagraphs();

  for (var p = 0; p < parrafos.length; p++) {

    parrafos[p].getRange().getParagraphStyle().setParagraphAlignment(SlidesApp.ParagraphAlignment.CENTER);

  }

}



function editarPlantillaDocs_(fileId, valores, textosInsertados) {

  var doc = DocumentApp.openById(fileId);

  var secciones = [doc.getBody(), doc.getHeader(), doc.getFooter()].filter(function(seccion) { return Boolean(seccion); });



  secciones.forEach(function(seccion) {

    Object.keys(valores).forEach(function(marcador) {

      seccion.replaceText(escaparRegex(marcador), valores[marcador] || '');

    });

    centrarSeccionDocs_(seccion, textosInsertados);

  });



  doc.saveAndClose();

}



function centrarSeccionDocs_(seccion, textosInsertados) {

  var buscados = textosInsertados.filter(function(texto) { return Boolean(texto); });

  if (!buscados.length || !seccion.getParagraphs) return;



  var parrafos = seccion.getParagraphs();

  for (var i = 0; i < parrafos.length; i++) {

    var texto = parrafos[i].getText();

    if (buscados.some(function(buscado) { return texto.indexOf(buscado) !== -1; })) {

      parrafos[i].setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    }

  }



  if (!seccion.getTables) return;

  var tablas = seccion.getTables();

  for (var t = 0; t < tablas.length; t++) {

    for (var r = 0; r < tablas[t].getNumRows(); r++) {

      var fila = tablas[t].getRow(r);

      for (var c = 0; c < fila.getNumCells(); c++) {

        var celda = fila.getCell(c);

        var coincide = buscados.some(function(buscado) { return celda.getText().indexOf(buscado) !== -1; });

        if (coincide) {

          var ps = celda.getParagraphs();

          for (var p = 0; p < ps.length; p++) ps[p].setAlignment(DocumentApp.HorizontalAlignment.CENTER);

        }

      }

    }

  }

}



function crearCarpetaLibre(nombreCarpeta) {

  var nombre = sanitizarNombreArchivo(

    String(nombreCarpeta || '').trim().toUpperCase()

  );



  if (!nombre) {

    throw new Error('El nombre de la carpeta está vacío.');

  }



  var nombreHoja = CONFIG_SISTEMA.HOJA_COMPILADOS;

  var idDestino = obtenerIdDesdeHoja('C4', nombreHoja);

  var carpeta = getOrCreateFolder(

    DriveApp.getFolderById(idDestino),

    nombre,

    {}

  );



  escribirLogsCaratulas_(nombreHoja, [

    crearFilaActividadCaratulas_(

      'Google Apps Script - Carátulas',

      'CARPETA: ' + nombre,

      '📁 Carpeta creada o verificada',

      carpeta.getUrl(),

      carpeta.getId()

    )

  ]);



  return {

    status: 'success',

    carpetaId: carpeta.getId(),

    carpetaUrl: carpeta.getUrl(),

    mensaje: '✅ Carpeta creada o encontrada correctamente.'

  };

}



function restaurarCaratulasBase(
  idPlantillaElegida,
  tipoCaratulaElegido
) {
  var nombreHoja = CONFIG_SISTEMA.HOJA_COMPILADOS;
  // Dos destinos posibles: C9 (exclusiva para Anexo 11 y 13) y C4
  // (biblioteca general, donde el compilador busca todo lo demás).
  var idBibliotecaAnexos = obtenerIdBibliotecaCaratulas_(nombreHoja); // C9
  var idBibliotecaGeneral = obtenerIdDesdeHoja('C4', nombreHoja);      // C4

  var idPlantilla = idPlantillaElegida ||
    extraerIdDeCeldaSegura(nombreHoja, 'C3');

  var plantilla = obtenerArchivoPlantillaDesdeId(idPlantilla);

  var tipo = tipoCaratulaElegido === 'nueva'
    ? 'nueva'
    : 'original';

  var cache = {};
  var logs = [];

  var grupos = [
    {
      destinoId: idBibliotecaAnexos, // C9
      carpeta: 'CARATULAS ANEXO 11 (NO BORRAR)',
      nombres: [
        '1. Ficha Diagnostico Tecnico Legal',
        '1.1 Plan de Saneamiento Fisico Legal',
        '2. Planos Diagnostico Tecnico Legal',
        '3. Certificado de Busqueda Catastral General',
        '4. Ficha Reniec',
        '5. Informe Tecnico Diagnostico',
        '6. Documento Legal',
      ]
    },
    {
      destinoId: idBibliotecaAnexos, // C9
      carpeta: 'CARATULAS ANEXO 13 (NO BORRAR)',
      nombres: [
        '1. FICHA SOCIOECONÓMICA',
        '2. FICHA TÉCNICA',
        '3. MEMORIA DESCRIPTIVA',
        '4. PLANOS',
        '5. DOC. DEL SUJETO PASIVO',
        '5.1. FICHA RENIEC',
        '5.1. FICHA RUC',
        '5.2. CONSTANCIA DE POSESIÓN',
        '5.2. DECLARACIÓN JURADA',
        '5.2. PARTIDA REGISTRAL',
        '6. INFORME TÉCNICO DE TASACIÓN'
      ]
    },
    {
      destinoId: idBibliotecaGeneral, // C4 (el compilador la busca ahí)
      carpeta: 'CARATULAS EXPEDIENTE DIAGNOSTICO (NO BORRAR)',
      nombres: [
        '1. Ficha Diag. Tec. Legal',
        '2. Planos Diag. Tec. Legal',
        '3. Cert. de Busq. Catastral',
        '4. Ficha Ruc'
      ]
    }
  ];

  var creadas = 0;

  var omitidas = 0;

  var errores = [];

  var archivosGenerados = []; // 👈 NUEVO



  grupos.forEach(function(grupo) {

    var carpeta = getOrCreateFolder(

      destino,

      grupo.carpeta,

      cache

    );



    grupo.nombres.forEach(function(nombreItem) {

      var filename =

        sanitizarNombreArchivo(nombreItem.toUpperCase()) + '.PDF';

      var existentes = carpeta.getFilesByName(filename);



      if (existentes.hasNext()) {

        var existente = existentes.next();

        omitidas++;



        logs.push(crearFilaActividadCaratulas_(

          'Google Apps Script - Restauración',

          filename,

          '⏭️ Carátula base omitida: ya existía',

          existente.getUrl(),

          existente.getId()

        ));

        return;

      }



      try {

        var pdfCreado = crearPDFDesdePlantilla_(

          plantilla,

          limpiarTextoSinPrefijoAvanzado(nombreItem),

          extraerPrefijoAvanzado(nombreItem),

          obtenerTextoVisual(nombreItem),

          filename,

          carpeta,

          tipo

        );



        creadas++;



        archivosGenerados.push({ // 👈 NUEVO

          origen: 'Anexos 11 y 13',

          id: pdfCreado.id,

          url: pdfCreado.url,

          name: pdfCreado.name

        });



        logs.push(crearFilaActividadCaratulas_(

          'Google Apps Script - Restauración',

          pdfCreado.name || filename,

          '✅ Carátula base restaurada',

          pdfCreado.url,

          pdfCreado.id

        ));



      } catch (error) {

        errores.push(nombreItem + ': ' + error.message);



        logs.push(crearFilaActividadCaratulas_(

          'Google Apps Script - Restauración',

          filename,

          '❌ Error al restaurar: ' + error.message,

          '',

          ''

        ));

      }

    });

  });



  var registrosAgregados = escribirLogsCaratulas_(

    nombreHoja,

    logs

  );



  return {

    status: errores.length

      ? (creadas ? 'partial' : 'error')

      : 'success',

    creadas: creadas,

    omitidas: omitidas,

    errores: errores,

    registrosAgregados: registrosAgregados,

    archivosGenerados: archivosGenerados, // 👈 NUEVO

    mensaje:

      (

        errores.length

          ? '⚠️ Restauración completada con observaciones. '

          : '✅ Restauración completada. '

      ) +

      'Creadas: ' + creadas +

      ' | Omitidas por existir: ' + omitidas +

      ' | Errores: ' + errores.length +

      ' | Actividades registradas: ' + registrosAgregados

  };

}
