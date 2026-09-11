// ====================================================================
// 🚀 MÓDULO 2: NÚCLEO DEL COMPILADOR AVANZADO
// ====================================================================

function buscarCaratulaPorNombreExactoContiene_(coversCache, patron) {
  var patronNorm = normalizarTexto(patron);
  for (var i = 0; i < coversCache.length; i++) {
    if (coversCache[i].nameNorm.indexOf(patronNorm) !== -1) return coversCache[i];
  }
  return null;
}

function buscarCaratulaPorContenidoNorm_(coversCache, subcadena) {
  return buscarCaratulaPorNombreExactoContiene_(coversCache, subcadena);
}

function obtenerCaratulaEspecial_(nombreArchivo, coversCache) {
  var texto = simplificar(nombreArchivo);
  if (texto.indexOf('reniec') !== -1 || texto.indexOf('dni') !== -1) {
    return buscarCaratulaPorNombreExactoContiene_(coversCache, 'reniec');
  }
  if (texto.indexOf('ruc') !== -1) {
    return buscarCaratulaPorNombreExactoContiene_(coversCache, 'ruc');
  }
  if (texto.indexOf('declaracion') !== -1 || texto.indexOf('jurada') !== -1) {
    return buscarCaratulaPorNombreExactoContiene_(coversCache, 'declaracion jurada');
  }
  if (texto.indexOf('partida') !== -1 || texto.indexOf('registral') !== -1) {
    return buscarCaratulaPorNombreExactoContiene_(coversCache, 'partida registral');
  }
  if (texto.indexOf('constancia') !== -1 || texto.indexOf('posesion') !== -1) {
    return buscarCaratulaPorNombreExactoContiene_(coversCache, 'constancia de posesion');
  }
  return null;
}

function extraerTodasLasCaratulas_(carpeta) {
  var lista = [];

  function recorrer(folder) {
    var archivos = folder.getFilesByType(MimeType.PDF);
    while (archivos.hasNext()) {
      var file = archivos.next();
      lista.push({ id: file.getId(), name: file.getName(), nameNorm: normalizarTexto(file.getName()) });
    }

    var subs = folder.getFolders();
    while (subs.hasNext()) recorrer(subs.next());
  }

  recorrer(carpeta);
  lista.sort(function(a, b) {
    return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
  });
  return lista;
}

function encontrarCaratulaPorCarpeta_(nombreCarpeta, listaCaratulas, permitirParcial) {
  var nombreNorm = normalizarTexto(limpiarNombrePDF(nombreCarpeta));
  if (!nombreNorm) return null;

  for (var i = 0; i < listaCaratulas.length; i++) {
    var coverNorm = normalizarTexto(limpiarNombrePDF(listaCaratulas[i].name));
    if (coverNorm === nombreNorm) return listaCaratulas[i];
  }

  if (permitirParcial) {
    for (var j = 0; j < listaCaratulas.length; j++) {
      var parcialNorm = normalizarTexto(limpiarNombrePDF(listaCaratulas[j].name));
      if (parcialNorm && (parcialNorm.indexOf(nombreNorm) !== -1 || nombreNorm.indexOf(parcialNorm) !== -1)) {
        return listaCaratulas[j];
      }
    }
  }

  return null;
}

function obtenerDatosParaCompilar(seleccionados) {
  var nombreHoja = CONFIG_SISTEMA.HOJA_COMPILADOS;
  var idC2 = obtenerIdDesdeHoja('C2', nombreHoja);
  var idC4 = obtenerIdDesdeHoja('C4', nombreHoja);
  var idC6 = obtenerIdDesdeHoja('C6', nombreHoja);
  var idBiblioteca = obtenerIdBibliotecaCaratulas_(nombreHoja);
  var filtrados = filtrarSeleccionadosMasEspecificos(seleccionados);

  if (!filtrados.length) throw new Error('No quedaron carpetas válidas después de eliminar selecciones duplicadas padre/hijo.');

  filtrados.sort(function(a, b) {
    return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
  });

  var caratulas = extraerTodasLasCaratulas_(DriveApp.getFolderById(idBiblioteca));
  var compilaciones = [];
  var caratulasMacroUsadas = {};

  for (var i = 0; i < filtrados.length; i++) {
    var sel = filtrados[i];
    var origen = DriveApp.getFolderById(sel.id);
    var ruta = obtenerRutaDesdeOrigen(sel.id, idC2);
    var primerOrden = determinarPrimerOrden_(sel, ruta, idC2);
    var grupo = determinarGrupoAnexo_(primerOrden);
    var secuencia = [];
    var alertas = [];

    // En los Anexos 11 y 13, la carátula general del anexo se incorpora
    // una sola vez y únicamente en el primer código real del grupo.
    if (
      grupo &&
      !caratulasMacroUsadas[grupo] &&
      esPrimerCodigoRealAnexoEspecial_(sel.id, idC2, grupo)
    ) {
      var macro = buscarCaratulaMacroAnexo_(grupo, primerOrden, caratulas);

      if (macro) {
        secuencia.push({
          id: macro.id,
          name: macro.name,
          type: 'Carátula General del ' + grupo
        });
        caratulasMacroUsadas[grupo] = true;
      } else {
        alertas.push(
          '⚠️ No se encontró la carátula general de ' + grupo +
          ' para incorporarla al primer código'
        );
      }
    }

    var principal = encontrarCaratulaPorCarpeta_(sel.name, caratulas, false);

    if (!principal) {
      principal = generarCaratulaPrincipalFaltante_(sel.name, idBiblioteca, nombreHoja, caratulas);
      if (!principal) {
        alertas.push('⚠️ No se pudo generar la carátula principal de "' + sel.name + '"');
      }
    }

    if (principal) {
      secuencia.push({
        id: principal.id,
        name: principal.name,
        type: 'Carátula Principal'
      });
    }

    if (grupo === 'ANEXO 11') {
      var resultado11 = construirSecuenciaAnexo11_(origen, caratulas);
      secuencia = secuencia.concat(resultado11.archivos);
      if (resultado11.alerta) alertas.push(resultado11.alerta);
    } else if (grupo === 'ANEXO 13') {
      secuencia = secuencia.concat(
        rastrearAnexo13_(origen, true, false, caratulas)
      );
    } else {
      secuencia = secuencia.concat(rastrearGenerico_(origen, true, caratulas));
    }

    secuencia = eliminarDuplicadosPorId_(secuencia);
    compilaciones.push({
      nombreCarpeta: sel.name,
      archivos: secuencia,
      alerta: alertas.join(' | '),
      folderPrimerOrden: primerOrden
    });
  }

  return { idC6: idC6, compilaciones: compilaciones };
}

// ====================================================================
// 🏷️ CARÁTULA PRINCIPAL FALTANTE — se genera al vuelo y se cachea
// ====================================================================
// Si un predio/código no tiene su carátula principal pre-generada en la
// biblioteca, en vez de omitirla (dejando el compilado sin portada), se
// genera aquí mismo con la plantilla de C3 y se guarda dentro de la
// biblioteca (C9) para que la próxima compilación la reutilice sin
// volver a crearla.
// ====================================================================
function generarCaratulaPrincipalFaltante_(nombreCarpeta, idBiblioteca, nombreHoja, caratulas) {
  try {
    var idPlantilla = extraerIdDeCeldaSegura(nombreHoja, 'C3');
    if (!idPlantilla) return null;

    var plantilla = obtenerArchivoPlantillaDesdeId(idPlantilla);
    var carpetaGeneradas = getOrCreateFolder(
      DriveApp.getFolderById(idBiblioteca),
      'CARATULAS PREDIOS (GENERADAS AUTOMATICAMENTE)',
      {}
    );

    var filename = sanitizarNombreArchivo(String(nombreCarpeta).trim().toUpperCase()) + '.PDF';
    var existentes = carpetaGeneradas.getFilesByName(filename);
    if (existentes.hasNext()) {
      var existente = existentes.next();
      var cover = { id: existente.getId(), name: existente.getName(), nameNorm: normalizarTexto(existente.getName()) };
      caratulas.push(cover);
      return cover;
    }

    var pdfCreado = crearPDFDesdePlantilla_(
      plantilla,
      limpiarTextoSinPrefijoAvanzado(nombreCarpeta),
      extraerPrefijoAvanzado(nombreCarpeta),
      obtenerTextoVisual(nombreCarpeta),
      filename,
      carpetaGeneradas,
      'original'
    );

    var creada = { id: pdfCreado.id, name: pdfCreado.name, nameNorm: normalizarTexto(pdfCreado.name) };
    caratulas.push(creada);
    return creada;
  } catch (error) {
    console.warn('No se pudo generar la carátula principal de "' + nombreCarpeta + '": ' + error.message);
    return null;
  }
}

function determinarPrimerOrden_(sel, ruta, idC2) {
  if (ruta.length) return sanitizarNombreArchivo(ruta[0].toUpperCase());

  var nombreSeleccion = String(sel.name || '').toUpperCase().trim();
  if (nombreSeleccion.indexOf('ANEXO') !== -1) return sanitizarNombreArchivo(nombreSeleccion);

  return sanitizarNombreArchivo(DriveApp.getFolderById(idC2).getName().toUpperCase()) || 'COMPILADOS';
}

function determinarGrupoAnexo_(primerOrden) {
  var texto = normalizarTexto(primerOrden);
  if (texto.indexOf('anexo 11') !== -1) return 'ANEXO 11';
  if (texto.indexOf('anexo 13') !== -1) return 'ANEXO 13';
  return '';
}


function buscarCaratulaMacroAnexo_(grupo, primerOrden, caratulas) {
  var exacta = encontrarCaratulaPorCarpeta_(primerOrden, caratulas, false);
  if (exacta) return exacta;

  var grupoNorm = normalizarTexto(grupo);
  var candidatas = caratulas.filter(function(caratula) {
    var nombre = normalizarTexto(limpiarNombrePDF(caratula.name));
    return (
      nombre.indexOf(grupoNorm) === 0 &&
      nombre.indexOf('compilado') === -1 &&
      nombre.indexOf('caratula tomo') === -1
    );
  });

  candidatas.sort(function(a, b) {
    var aNorm = normalizarTexto(limpiarNombrePDF(a.name));
    var bNorm = normalizarTexto(limpiarNombrePDF(b.name));

    // Se prioriza el nombre más descriptivo, no un título abreviado.
    if (aNorm.length !== bNorm.length) return bNorm.length - aNorm.length;
    return a.name.localeCompare(b.name, 'es', {
      numeric: true,
      sensitivity: 'base'
    });
  });

  return candidatas.length ? candidatas[0] : null;
}

function esPrimerCodigoRealAnexoEspecial_(folderId, idOrigen, grupo) {
  try {
    var seleccionado = DriveApp.getFolderById(folderId);
    var actual = seleccionado;
    var hijoDirecto = seleccionado;
    var carpetaAnexo = null;
    var seguridad = 0;

    while (seguridad++ < 100) {
      var padres = actual.getParents();
      if (!padres.hasNext()) break;

      var padre = padres.next();
      if (padre.getId() === idOrigen) {
        carpetaAnexo = actual;
        break;
      }

      hijoDirecto = actual;
      actual = padre;
    }

    if (!carpetaAnexo || determinarGrupoAnexo_(carpetaAnexo.getName()) !== grupo) {
      return false;
    }

    // Si se seleccionó la propia carpeta del anexo, la carátula general ya
    // será su carátula principal y no debe insertarse nuevamente.
    if (seleccionado.getId() === carpetaAnexo.getId()) return false;

    var hijos = [];
    var iterator = carpetaAnexo.getFolders();

    while (iterator.hasNext()) {
      var hijo = iterator.next();
      var nombreNorm = normalizarTexto(hijo.getName());

      if (
        nombreNorm.indexOf('caratula') !== -1 ||
        nombreNorm.indexOf('no borrar') !== -1
      ) {
        continue;
      }

      hijos.push(hijo);
    }

    hijos.sort(function(a, b) {
      return a.getName().localeCompare(b.getName(), 'es', {
        numeric: true,
        sensitivity: 'base'
      });
    });

    if (!hijos.length) return false;

    var hijosNumerados = hijos.filter(function(hijo) {
      return /^(?:codigo\s*)?0*\d+(?:\.\d+)*\b/i.test(hijo.getName().trim());
    });

    var primerHijo = hijosNumerados.length ? hijosNumerados[0] : hijos[0];
    return primerHijo.getId() === hijoDirecto.getId();
  } catch (error) {
    console.warn(
      'No se pudo determinar el primer código de ' + grupo + ': ' + error.message
    );
    return false;
  }
}

function construirSecuenciaAnexo11_(origen, caratulas) {
  var encontrados = [];
  var existeCarpetaCBC = false;

  function recorrer(folder, contexto) {
    var nombre = normalizarTexto(folder.getName());
    var nuevoContexto = {
      cbc: contexto.cbc || nombre.indexOf('cbc') !== -1 || nombre.indexOf('certificado') !== -1 || nombre.indexOf('catastral') !== -1,
      informe: contexto.informe || nombre.indexOf('informe') !== -1
    };

    if (nuevoContexto.cbc) existeCarpetaCBC = true;

    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      encontrados.push({ file: files.next(), contexto: nuevoContexto });
    }

    var subs = folder.getFolders();
    while (subs.hasNext()) recorrer(subs.next(), nuevoContexto);
  }

  recorrer(origen, { cbc: false, informe: false });

  var bloques = { b1: [], b2: [], b3: [], b4: [], b5: [] };

  encontrados.forEach(function(item) {
    var nombre = simplificar(item.file.getName());
    if (nombre.indexOf('diagnosticotecnicolegal') !== -1 || nombre.indexOf('fichadediagnostico') !== -1) {
      bloques.b1.push(item.file);
    } else if (nombre.indexOf('plandesaneamiento') !== -1) {
      bloques.b2.push(item.file);
    } else if (item.contexto.cbc || nombre.indexOf('certificadodebusqueda') !== -1) {
      bloques.b4.push(item.file);
    } else if (item.contexto.informe || nombre.indexOf('informetecnico') !== -1) {
      bloques.b5.push(item.file);
    } else {
      bloques.b3.push(item.file);
    }
  });

  ordenarFiles_(bloques.b1);
  ordenarFiles_(bloques.b2);
  ordenarFiles_(bloques.b5);

  var planosNormales = [];
  var planosPP = [];
  bloques.b3.forEach(function(file) {
    var sinNumero = simplificar(file.getName()).replace(/^\d+/, '');
    (sinNumero.indexOf('pp') === 0 ? planosPP : planosNormales).push(file);
  });
  ordenarFiles_(planosNormales);
  ordenarFiles_(planosPP);
  bloques.b3 = planosNormales.concat(planosPP);

  bloques.b4.sort(function(a, b) {
    var aGeneral = normalizarTexto(a.getName()).indexOf('general') !== -1;
    var bGeneral = normalizarTexto(b.getName()).indexOf('general') !== -1;
    if (aGeneral !== bGeneral) return aGeneral ? -1 : 1;
    return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
  });

  var secuencia = [];
  agregarBloque_(secuencia, bloques.b1, caratulas, 'diagnostico tecnico legal');
  agregarBloque_(secuencia, bloques.b2, caratulas, 'plan de saneamiento');
  agregarBloque_(secuencia, bloques.b3, caratulas, 'planos diagnostico');
  agregarBloque_(secuencia, bloques.b4, caratulas, 'certificado de busqueda');
  agregarBloque_(secuencia, bloques.b5, caratulas, 'informe tecnico diagnostico');

  return {
    archivos: secuencia,
    alerta: existeCarpetaCBC && !bloques.b4.length ? '⚠️ Carpeta de Certificado Catastral vacía' : ''
  };
}

function agregarBloque_(secuencia, files, caratulas, patronCaratula) {
  if (!files.length) return;
  var cover = buscarCaratulaPorContenidoNorm_(caratulas, patronCaratula);
  if (cover) secuencia.push({ id: cover.id, name: cover.name, type: 'Carátula Bloque' });
  files.forEach(function(file) {
    secuencia.push({ id: file.getId(), name: file.getName(), type: 'Original' });
  });
}

function rastrearAnexo13_(folder, isRoot, inSujetoPasivo, caratulas) {
  var secuencia = [];
  var nombreNorm = normalizarTexto(folder.getName());
  var esSujetoPasivo = inSujetoPasivo ||
    nombreNorm.indexOf('sujeto pasivo') !== -1 ||
    /^5(?:[.\s]|$)/.test(nombreNorm) ||
    nombreNorm.indexOf('5.0') !== -1;

  var originales = [];
  var files = folder.getFilesByType(MimeType.PDF);
  while (files.hasNext()) originales.push(files.next());
  ordenarFiles_(originales);

  var especialesUsadas = {};
  originales.forEach(function(file) {
    if (esSujetoPasivo) {
      var especial = obtenerCaratulaEspecial_(file.getName(), caratulas);
      if (especial && !especialesUsadas[especial.id]) {
        secuencia.push({ id: especial.id, name: especial.name, type: 'Carátula Interna Específica' });
        especialesUsadas[especial.id] = true;
      }
    }
    secuencia.push({ id: file.getId(), name: file.getName(), type: 'Original' });
  });

  var subs = [];
  var iterator = folder.getFolders();
  while (iterator.hasNext()) subs.push(iterator.next());
  subs.sort(function(a, b) {
    return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
  });

  subs.forEach(function(sub) {
    secuencia = secuencia.concat(rastrearAnexo13_(sub, false, esSujetoPasivo, caratulas));
  });

  if (!isRoot && secuencia.length) {
    var cover = encontrarCaratulaPorCarpeta_(folder.getName(), caratulas, true);
    if (cover && !especialesUsadas[cover.id]) {
      secuencia.unshift({ id: cover.id, name: cover.name, type: 'Carátula General de Carpeta' });
    }
  }

  return secuencia;
}

function rastrearGenerico_(folder, isRoot, caratulas) {
  var secuencia = [];
  var files = [];
  var iteratorFiles = folder.getFilesByType(MimeType.PDF);
  while (iteratorFiles.hasNext()) files.push(iteratorFiles.next());
  ordenarFiles_(files);

  files.forEach(function(file) {
    secuencia.push({ id: file.getId(), name: file.getName(), type: 'Original' });
  });

  var subs = [];
  var iterator = folder.getFolders();
  while (iterator.hasNext()) subs.push(iterator.next());
  subs.sort(function(a, b) {
    return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
  });

  subs.forEach(function(sub) {
    secuencia = secuencia.concat(rastrearGenerico_(sub, false, caratulas));
  });

  if (!isRoot && secuencia.length) {
    var cover = encontrarCaratulaPorCarpeta_(folder.getName(), caratulas, true);
    if (cover) secuencia.unshift({ id: cover.id, name: cover.name, type: 'Carátula Carpeta' });
  }

  return secuencia;
}

function ordenarFiles_(files) {
  files.sort(function(a, b) {
    return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
  });
}

function eliminarDuplicadosConsecutivos_(secuencia) {
  var salida = [];
  for (var i = 0; i < secuencia.length; i++) {
    if (!salida.length || salida[salida.length - 1].id !== secuencia[i].id) salida.push(secuencia[i]);
  }
  return salida;
}


function eliminarDuplicadosPorId_(secuencia) {
  var salida = [];
  var vistos = {};

  (secuencia || []).forEach(function(item) {
    if (!item || !item.id || vistos[item.id]) return;
    vistos[item.id] = true;
    salida.push(item);
  });

  return salida;
}

function procesarCompilacionSegunModo(seleccionados, metodo, config) {
  if (metodo && metodo !== 'COLAB') {
    throw new Error("Solo está habilitado el modo 'COLAB'.");
  }

  var nombreHoja = CONFIG_SISTEMA.HOJA_COMPILADOS;
  var sheet = obtenerHojaSegura(nombreHoja);
  var datos = obtenerDatosParaCompilar(seleccionados);
  var endpoint = normalizarUrlEndpoint(sheet.getRange('C8').getDisplayValue(), 'compilar');
  var baseServidor = obtenerBaseServidorCompilador_(endpoint);
  var token = ScriptApp.getOAuthToken();
  var opciones = config || {};
  var politicaDuplicados = ['nuevo', 'reemplazar', 'omitir'].indexOf(opciones.duplicados) !== -1
    ? opciones.duplicados
    : 'nuevo';

  var limitePaginas = obtenerValorConfigCompilador_('LIMITE_PAGINAS', 600);
  var paralelas = obtenerValorConfigCompilador_('PETICIONES_PARALELAS', 2);
  var estricto = Boolean(obtenerValorConfigSistema_('MODO_ESTRICTO_COMPILADOR', true));
  var cacheCarpetas = {};
  var solicitudes = [];
  var referencias = [];
  var omitidos = 0;

  datos.compilaciones.forEach(function(comp, indice) {
    var fileIds = [];
    var tieneOriginales = false;

    comp.archivos.forEach(function(item) {
      fileIds.push(item.id);
      if (item.type === 'Original') tieneOriginales = true;
    });

    if (!tieneOriginales || !fileIds.length) {
      omitidos++;
      return;
    }

    var destinoRaiz = DriveApp.getFolderById(datos.idC6);
    var destino = getOrCreateFolder(destinoRaiz, comp.folderPrimerOrden, cacheCarpetas);
    var nombreBase = sanitizarNombreArchivo('COMPILADO_' + comp.nombreCarpeta.toUpperCase());
    var existentes = obtenerCompiladosExistentes_(destino, nombreBase);

    if (existentes.length && politicaDuplicados === 'omitir') {
      omitidos++;
      return;
    }

    // En modo reemplazar NO se eliminan todavía los archivos buenos anteriores.
    // Solo se enviarán a la papelera después de confirmar el nuevo resultado.
    var idsReemplazar = politicaDuplicados === 'reemplazar'
      ? existentes.map(function(file) { return file.getId(); })
      : [];

    var fechaInicio = new Date();
    var marca = Utilities.formatDate(
      fechaInicio,
      Session.getScriptTimeZone(),
      'yyyyMMdd_HHmmss_SSS'
    );
    var nombreSalida = nombreBase + ' (' + marca + '_' + (indice + 1) + ').pdf';
    var requestId = Utilities.getUuid();

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
        expected_source_count: fileIds.length,
        file_ids: fileIds,
        destination_folder_id: destino.getId(),
        output_filename: nombreSalida,
        limite_paginas: limitePaginas
      }),
      muteHttpExceptions: true
    });

    referencias.push({
      comp: {
        nombreCarpeta: comp.nombreCarpeta,
        alerta: comp.alerta || ''
      },
      nombreSalida: nombreSalida,
      prefijoSalida: nombreSalida.replace(/\.pdf$/i, ''),
      destinoId: destino.getId(),
      fechaInicioMs: fechaInicio.getTime(),
      requestId: requestId,
      idsReemplazar: idsReemplazar,
      ultimoError: '',
      intentos: 0,
      estabilidad: { firma: '', rondas: 0, partes: [] }
    });
  });

  if (!solicitudes.length) {
    return {
      status: 'success', creados: 0, pendientes: 0, omitidos: omitidos, errores: 0,
      archivosGenerados: [], // 👈 NUEVO
      mensaje: 'No hubo compilaciones nuevas para enviar. Omitidos: ' + omitidos + '.'
    };
  }

  var logs = [];
  var totalCreados = 0;
  var totalErrores = 0;
  var pendientes = [];
  var sinConfirmacion = [];
  var archivosGenerados = []; // 👈 NUEVO
  var respuestasIniciales = ejecutarSolicitudesSegurasPorBloques_(solicitudes, paralelas);

  for (var i = 0; i < referencias.length; i++) {
    var resultadoInicial = respuestasIniciales[i] || {};
    var refInicial = referencias[i];

    if (!resultadoInicial.response) {
      refInicial.ultimoError = resultadoInicial.error || 'No se recibió respuesta inicial.';
      sinConfirmacion.push(refInicial);
      continue;
    }

    var code = resultadoInicial.response.getResponseCode();
    var text = resultadoInicial.response.getContentText();
    var data = parsearJsonSeguro(text);

    if ((code === 200 || code === 202) && data && data.job_id) {
      pendientes.push({ jobId: String(data.job_id), ref: refInicial });
      continue;
    }

    if (code >= 200 && code < 300 && data &&
        (data.status === 'success' || data.status === 'partial') &&
        Array.isArray(data.partes)) {
      var cuenta = registrarResultadoCompilador_(data, refInicial, logs, false, archivosGenerados);
      totalCreados += cuenta.creados;
      totalErrores += cuenta.errores;
      continue;
    }

    refInicial.ultimoError = construirDetalleHttpCompilador_(code, data, text);
    sinConfirmacion.push(refInicial);
  }

  escribirLogsCompilador_(sheet, logs);
  guardarPendientesCompilador_(baseServidor, pendientes, sinConfirmacion);

  var cantidadPendiente = pendientes.length + sinConfirmacion.length;
  return {
    status: cantidadPendiente ? 'pending' : (totalErrores ? 'partial' : 'success'),
    creados: totalCreados,
    pendientes: cantidadPendiente,
    omitidos: omitidos,
    errores: totalErrores,
    archivosGenerados: archivosGenerados, // 👈 NUEVO
    mensaje:
      '✅ Solicitudes enviadas. PDF confirmados inmediatamente: ' + totalCreados +
      ' | Pendientes: ' + cantidadPendiente +
      ' | Omitidos: ' + omitidos +
      ' | Errores: ' + totalErrores + '. ' +
      (cantidadPendiente
        ? 'Los trabajos continúan en Colab. Usa “Consultar pendientes” para actualizar el resultado.'
        : '')
  };
}

function obtenerValorConfigCompilador_(clave, valorPredeterminado) {
  try {
    if (
      typeof CONFIG_SISTEMA !== 'undefined' &&
      CONFIG_SISTEMA &&
      CONFIG_SISTEMA[clave] !== undefined &&
      CONFIG_SISTEMA[clave] !== null &&
      CONFIG_SISTEMA[clave] !== ''
    ) {
      var valor = Number(CONFIG_SISTEMA[clave]);
      if (isFinite(valor) && valor > 0) return valor;
    }
  } catch (e) {}

  return valorPredeterminado;
}

function obtenerBaseServidorCompilador_(endpoint) {
  return String(endpoint || '')
    .trim()
    .replace(/\/compilar\/?$/i, '')
    .replace(/\/+$/, '');
}

function construirDetalleHttpCompilador_(code, data, text) {
  var detalle = '';

  if (data && data.detail) {
    detalle = String(data.detail);
  } else if (data && data.message) {
    detalle = String(data.message);
  } else if (text) {
    detalle = String(text).substring(0, 300);
  } else {
    detalle = 'Respuesta vacía';
  }

  return 'HTTP ' + code + ': ' + detalle;
}

function registrarResultadoCompilador_(data, ref, logs, recuperado, archivosGenerados) {
  var resultado = { creados: 0, errores: 0 };
  var partes = data && Array.isArray(data.partes) ? data.partes : [];

  if (!partes.length) {
    resultado.errores++;
    logs.push([new Date(), ref.comp.nombreCarpeta, 'Error en ejecución',
      '❌ El servidor no creó partes.', '', '']);
    return resultado;
  }

  partes.forEach(function(parte, indice) {
    var mensaje = recuperado
      ? '✅ PDF encontrado en Drive después de una interrupción de conexión'
      : '✅ Compilado por Colab';

    if (partes.length > 1) mensaje += ' (Parte ' + (indice + 1) + ')';
    if (data.status === 'partial') mensaje += ' | ⚠️ Algunos archivos fueron omitidos por el servidor';
    if (ref.comp.alerta) mensaje += ' | ' + ref.comp.alerta;

    logs.push([
      new Date(),
      recuperado ? 'Recuperación automática desde Drive' : 'Servidor Google Colab',
      parte.final_name || ref.nombreSalida,
      mensaje,
      parte.url || '',
      parte.id || ''
    ]);

    if (archivosGenerados && parte.id) { // 👈 NUEVO
      archivosGenerados.push({
        origen: ref.comp.nombreCarpeta,
        id: parte.id,
        url: parte.url || '',
        name: parte.final_name || ref.nombreSalida
      });
    }

    resultado.creados++;
  });

  // Reemplazo seguro: primero se confirma la nueva salida y recién después
  // se eliminan las versiones anteriores.
  if (resultado.creados > 0 && data.status !== 'partial' && ref.idsReemplazar) {
    enviarArchivosPapeleraPorId_(
      ref.idsReemplazar,
      partes.map(function(parte) { return parte.id; })
    );
    ref.idsReemplazar = [];
  }

  return resultado;
}

function actualizarEstabilidadRecuperacion_(ref, forzar) {
  var encontrado = buscarResultadosRecientesCompilador_(ref);

  if (!encontrado.partes.length) {
    ref.estabilidad.firma = '';
    ref.estabilidad.rondas = 0;
    ref.estabilidad.partes = [];
    return null;
  }

  if (encontrado.firma === ref.estabilidad.firma) {
    ref.estabilidad.rondas++;
  } else {
    ref.estabilidad.firma = encontrado.firma;
    ref.estabilidad.rondas = 1;
    ref.estabilidad.partes = encontrado.partes;
  }

  if (forzar || ref.estabilidad.rondas >= 2) {
    return {
      status: 'success',
      recovered: true,
      partes: ref.estabilidad.partes
    };
  }

  return null;
}

function recuperarResultadoFinalDesdeDrive_(ref) {
  var encontrado = buscarResultadosRecientesCompilador_(ref);

  if (!encontrado.partes.length) return null;

  return {
    status: 'success',
    recovered: true,
    partes: encontrado.partes
  };
}

function buscarResultadosRecientesCompilador_(ref) {
  var carpeta = DriveApp.getFolderById(ref.destinoId);
  var files = carpeta.getFilesByType(MimeType.PDF);
  var prefijo = String(ref.prefijoSalida || '').toUpperCase();
  var fechaMinima = Number(ref.fechaInicioMs || 0) - 120000;
  var encontrados = [];

  while (files.hasNext()) {
    var file = files.next();
    var nombre = file.getName();
    var fechaCreacion = file.getDateCreated().getTime();

    if (
      nombre.toUpperCase().indexOf(prefijo) === 0 &&
      fechaCreacion >= fechaMinima
    ) {
      encontrados.push({
        id: file.getId(),
        url: file.getUrl(),
        final_name: nombre,
        size: file.getSize(),
        created: fechaCreacion
      });
    }
  }

  encontrados.sort(function(a, b) {
    return a.final_name.localeCompare(
      b.final_name,
      'es',
      { numeric: true, sensitivity: 'base' }
    );
  });

  var firma = encontrados.map(function(item) {
    return [
      item.id,
      item.size,
      item.final_name
    ].join(':');
  }).join('|');

  var partes = encontrados.map(function(item) {
    return {
      id: item.id,
      url: item.url,
      final_name: item.final_name
    };
  });

  return {
    firma: firma,
    partes: partes
  };
}

function obtenerCompiladosExistentes_(carpeta, nombreBase) {
  var encontrados = [];
  var files = carpeta.getFilesByType(MimeType.PDF);
  var base = nombreBase.toUpperCase();

  while (files.hasNext()) {
    var file = files.next();
    if (file.getName().toUpperCase().indexOf(base) === 0) {
      encontrados.push(file);
    }
  }

  return encontrados;
}

function ejecutarSolicitudesSegurasPorBloques_(solicitudes, tamanoBloque) {
  var resultados = [];
  var limite = Math.max(1, Number(tamanoBloque) || 1);

  for (var i = 0; i < solicitudes.length; i += limite) {
    var bloque = solicitudes.slice(i, i + limite);

    try {
      var respuestas = UrlFetchApp.fetchAll(bloque);

      for (var r = 0; r < respuestas.length; r++) {
        resultados.push({
          response: respuestas[r],
          error: ''
        });
      }
    } catch (errorBloque) {
      for (var j = 0; j < bloque.length; j++) {
        try {
          resultados.push({
            response: UrlFetchApp.fetch(bloque[j].url, bloque[j]),
            error: ''
          });
        } catch (errorIndividual) {
          resultados.push({
            response: null,
            error:
              'NetworkError: ' +
              (errorIndividual && errorIndividual.message
                ? errorIndividual.message
                : String(errorIndividual || errorBloque))
          });
        }
      }
    }
  }

  return resultados;
}

function escribirLogsCompilador_(sheet, filas) {
  if (!filas.length) return;

  var inicio = Math.max(15, sheet.getLastRow() + 1);
  sheet.getRange(inicio, 1, filas.length, 6).setValues(filas);
}

// ====================================================================
// ⏳ CONSULTA REANUDABLE DE COMPILACIONES
// ====================================================================
var CLAVE_PENDIENTES_COMPILADOR_ = 'PENDIENTES_COMPILADOR_V3';

function guardarPendientesCompilador_(baseServidor, pendientes, sinConfirmacion) {
  var anterior = leerEstadoJsonFragmentado_(CLAVE_PENDIENTES_COMPILADOR_) || {};
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
    eliminarEstadoJsonFragmentado_(CLAVE_PENDIENTES_COMPILADOR_);
    return;
  }

  guardarEstadoJsonFragmentado_(CLAVE_PENDIENTES_COMPILADOR_, {
    version: 3,
    baseServidor: baseServidor,
    actualizado: Date.now(),
    pendientes: jobs,
    sinConfirmacion: inciertos
  });
}

function consultarCompilacionesPendientes() {
  var estado = leerEstadoJsonFragmentado_(CLAVE_PENDIENTES_COMPILADOR_);
  if (!estado || (!(estado.pendientes || []).length && !(estado.sinConfirmacion || []).length)) {
    return { status: 'success', creados: 0, pendientes: 0, errores: 0,
      archivosGenerados: [], // 👈 NUEVO
      mensaje: 'No existen compilaciones pendientes.' };
  }

  var sheet = obtenerHojaSegura(CONFIG_SISTEMA.HOJA_COMPILADOS);
  var endpoint = normalizarUrlEndpoint(sheet.getRange('C8').getDisplayValue(), 'compilar');
  var baseServidor = obtenerBaseServidorCompilador_(endpoint);
  var token = ScriptApp.getOAuthToken();
  var pendientes = estado.pendientes || [];
  var inciertos = estado.sinConfirmacion || [];
  var siguientes = [];
  var siguientesInciertos = [];
  var logs = [];
  var creados = 0;
  var errores = 0;
  var archivosGenerados = []; // 👈 NUEVO

  var consultas = pendientes.map(function(item) {
    return {
      url: baseServidor + '/trabajos/' + encodeURIComponent(item.jobId),
      method: 'get',
      headers: obtenerHeadersServidor_(token),
      muteHttpExceptions: true
    };
  });
  var respuestas = ejecutarSolicitudesSegurasPorBloques_(
    consultas,
    Math.max(1, Number(obtenerValorConfigSistema_('PETICIONES_PARALELAS', 2)) * 2)
  );

  pendientes.forEach(function(item, indice) {
    var resultado = respuestas[indice] || {};
    var ref = item.ref;
    if (!resultado.response) {
      ref.intentos = Number(ref.intentos || 0) + 1;
      ref.ultimoError = resultado.error || 'No se pudo consultar el trabajo.';
      var rec = actualizarEstabilidadRecuperacion_(ref);
      if (rec) {
        var c = registrarResultadoCompilador_(rec, ref, logs, true, archivosGenerados);
        creados += c.creados; errores += c.errores;
      } else if (ref.intentos >= 6) {
        errores++;
        logs.push([new Date(), ref.comp.nombreCarpeta, 'Sin confirmación',
          '❌ ' + ref.ultimoError, '', '']);
      } else {
        siguientes.push(item);
      }
      return;
    }

    var code = resultado.response.getResponseCode();
    var text = resultado.response.getContentText();
    var data = parsearJsonSeguro(text);

    if (code === 200 && data &&
        (data.job_state === 'queued' || data.job_state === 'running' ||
         data.status === 'accepted' || data.status === 'running')) {
      siguientes.push(item);
      return;
    }

    if (code === 200 && data &&
        (data.status === 'success' || data.status === 'partial') &&
        Array.isArray(data.partes)) {
      var cuenta = registrarResultadoCompilador_(data, ref, logs, false, archivosGenerados);
      creados += cuenta.creados; errores += cuenta.errores;
      return;
    }

    var recuperado = recuperarResultadoFinalDesdeDrive_(ref);
    if (recuperado) {
      var cuentaRec = registrarResultadoCompilador_(recuperado, ref, logs, true, archivosGenerados);
      creados += cuentaRec.creados; errores += cuentaRec.errores;
    } else if (data && (data.job_state === 'failed' || data.status === 'error')) {
      errores++;
      logs.push([new Date(), ref.comp.nombreCarpeta, 'Error en ejecución',
        '❌ ' + (data.detail || data.message || 'El trabajo falló.'), '', '']);
    } else {
      ref.intentos = Number(ref.intentos || 0) + 1;
      ref.ultimoError = construirDetalleHttpCompilador_(code, data, text);
      if (ref.intentos >= 6) {
        errores++;
        logs.push([new Date(), ref.comp.nombreCarpeta, 'Sin confirmación',
          '❌ ' + ref.ultimoError, '', '']);
      } else {
        siguientes.push(item);
      }
    }
  });

  inciertos.forEach(function(ref) {
    var recuperado = actualizarEstabilidadRecuperacion_(ref);
    if (recuperado) {
      var cuenta = registrarResultadoCompilador_(recuperado, ref, logs, true, archivosGenerados);
      creados += cuenta.creados; errores += cuenta.errores;
    } else {
      ref.intentos = Number(ref.intentos || 0) + 1;
      if (ref.intentos >= 6) {
        errores++;
        logs.push([new Date(), ref.comp.nombreCarpeta, 'Error de conexión',
          '❌ No se confirmó el trabajo ni se encontró el PDF en Drive. ' +
          (ref.ultimoError || ''), '', '']);
      } else {
        siguientesInciertos.push(ref);
      }
    }
  });

  escribirLogsCompilador_(sheet, logs);
  eliminarEstadoJsonFragmentado_(CLAVE_PENDIENTES_COMPILADOR_);
  guardarPendientesCompilador_(baseServidor, siguientes, siguientesInciertos);

  var restantes = siguientes.length + siguientesInciertos.length;
  return {
    status: restantes ? 'pending' : (errores ? (creados ? 'partial' : 'error') : 'success'),
    creados: creados,
    pendientes: restantes,
    errores: errores,
    archivosGenerados: archivosGenerados, // 👈 NUEVO
    mensaje: 'Consulta terminada. PDF confirmados: ' + creados +
      ' | Pendientes: ' + restantes + ' | Errores: ' + errores + '.'
  };
}
