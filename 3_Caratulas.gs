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
    var idPlantilla = caratula.idPlantilla ||
      extraerIdDeCeldaSegura(nombreHoja, 'C3');
    archivoPlantilla = obtenerArchivoPlantillaDesdeId(idPlantilla);
  }

  var destinoRaiz = DriveApp.getFolderById(idDestino);
  var cacheCarpetas = {};
  var logs = [];
  var resultado = {
    status: 'success',
    procesados: 0,
    carpetasPreparadas: 0,
    pdfsCreados: 0,
    omitidos: 0,
    errores: [],
    registrosAgregados: 0
  };

  for (var i = 0; i < lote.length; i++) {
    var item = lote[i];
    resultado.procesados++;

    try {
      if (!item || !item.id || !item.name) {
        throw new Error('Elemento seleccionado incompleto.');
      }

      var carpetaGuardar = destinoRaiz;
      var ruta = obtenerRutaDesdeOrigen(item.id, idOrigen);

      if (ubicacion.tipo === 'automatico') {
        for (var r = 0; r < ruta.length; r++) {
          carpetaGuardar = getOrCreateFolder(
            carpetaGuardar,
            ruta[r],
            cacheCarpetas
          );
        }

        carpetaGuardar = getOrCreateFolder(
          carpetaGuardar,
          item.name,
          cacheCarpetas
        );
      } else {
        var nombreManual = String(
          ubicacion.nombreNuevaCarpeta || ''
        ).trim();

        if (nombreManual) {
          carpetaGuardar = getOrCreateFolder(
            carpetaGuardar,
            sanitizarNombreArchivo(nombreManual.toUpperCase()),
            cacheCarpetas
          );
        }
      }

      resultado.carpetasPreparadas++;

      if (soloCarpetas) {
        logs.push(crearFilaActividadCaratulas_(
          'Google Apps Script - Carátulas',
          'CARPETA: ' + item.name,
          '📁 Carpeta preparada o verificada',
          carpetaGuardar.getUrl(),
          carpetaGuardar.getId()
        ));
        continue;
      }

      var textoVisual = obtenerTextoVisual(item.name);
      var prefijo = extraerPrefijoAvanzado(item.name);
      var textoLimpio = limpiarTextoSinPrefijoAvanzado(item.name);
      var filenameFinal =
        sanitizarNombreArchivo(item.name.trim().toUpperCase()) + '.PDF';

      // Conserva las reglas especiales ya usadas en los Anexos 11 y 13.
      if (ruta.length > 0) {
        var primerNivel = normalizarTexto(ruta[0]);
        var esAnexoEspecial =
          primerNivel.indexOf('anexo 11') !== -1 ||
          primerNivel.indexOf('anexo 13') !== -1;

        if (
          esAnexoEspecial &&
          ruta.length === 1 &&
          textoLimpio.length >= 9
        ) {
          textoLimpio = textoLimpio.slice(-9);
        } else if (
          esAnexoEspecial &&
          ruta.length === 2 &&
          textoLimpio.length > 3
        ) {
          textoLimpio = textoLimpio.substring(3).trim();
        }
      }

      var existentes = carpetaGuardar.getFilesByName(filenameFinal);

      if (existentes.hasNext()) {
        var existente = existentes.next();
        resultado.omitidos++;

        logs.push(crearFilaActividadCaratulas_(
          'Google Apps Script - Carátulas',
          filenameFinal,
          '⏭️ Carátula omitida: ya existía',
          existente.getUrl(),
          existente.getId()
        ));
        continue;
      }

      var pdfCreado = crearPDFDesdePlantilla_(
        archivoPlantilla,
        textoLimpio,
        prefijo,
        textoVisual,
        filenameFinal,
        carpetaGuardar,
        tipo
      );

      resultado.pdfsCreados++;

      logs.push(crearFilaActividadCaratulas_(
        'Google Apps Script - Carátulas',
        pdfCreado.name || filenameFinal,
        '✅ Carátula creada',
        pdfCreado.url,
        pdfCreado.id
      ));

    } catch (error) {
      var nombreError = item && item.name
        ? String(item.name)
        : 'Sin nombre';

      resultado.errores.push({
        item: nombreError,
        detalle: error.message
      });

      logs.push(crearFilaActividadCaratulas_(
        'Google Apps Script - Carátulas',
        nombreError,
        '❌ Error al procesar: ' + error.message,
        '',
        ''
      ));
    }
  }

  resultado.registrosAgregados = escribirLogsCaratulas_(
    nombreHoja,
    logs
  );

  if (resultado.errores.length) {
    resultado.status = resultado.pdfsCreados ||
      resultado.carpetasPreparadas
      ? 'partial'
      : 'error';
  }

  resultado.mensaje = construirMensajeCaratulas_(resultado);
  return resultado;
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
  var idDestino = obtenerIdDesdeHoja('C4', nombreHoja);
  var idPlantilla = idPlantillaElegida ||
    extraerIdDeCeldaSegura(nombreHoja, 'C3');
  var plantilla = obtenerArchivoPlantillaDesdeId(idPlantilla);
  var tipo = tipoCaratulaElegido === 'nueva'
    ? 'nueva'
    : 'original';
  var destino = DriveApp.getFolderById(idDestino);
  var cache = {};
  var logs = [];

  var grupos = [
    {
      carpeta: 'CARATULAS ANEXO 11 (NO BORRAR)',
      nombres: [
        '1. Ficha Diag. Tec. Legal',
        '2. PLanos Diag. Tec. Legal',
        '3. Ficha Reniec',
        '4. Documento Legal',
      ]
    },
    {
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
    }
  ];

  var creadas = 0;
  var omitidas = 0;
  var errores = [];

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
