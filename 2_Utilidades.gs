// ====================================================================
// 🛠️ FUNCIONES AUXILIARES COMPARTIDAS - ÚNICA FUENTE
// ====================================================================

var CONFIG_SISTEMA = Object.freeze({
  HOJA_COMPILADOS: 'CARATULAS Y COMPILADOS',
  HOJA_TOMOS: 'TOMOS',
  LIMITE_PAGINAS: 500,
  LIMITE_MINIMO_TOMO: 0,
  PETICIONES_PARALELAS: 2,
  MODO_ESTRICTO_COMPILADOR: true,
  MODO_ESTRICTO_TOMOS: true,
  VALIDAR_PROYECCION_TOMOS: true,
  MAX_CAMBIOS_PROYECCION_MOSTRAR: 8,
  CLAVE_SERVIDOR: '',
  CARATULAS_NO_FOLIADAS_POR_TOMO: 1,
  CARPETA_INDICES_TOMOS: 'ÍNDICES DE TOMOS',
  CARPETA_TOMOS_FINALES: 'TOMOS FINALES',
  INTERVALO_CONSULTA_TOMOS_MS: 2500,
  TIEMPO_MAX_ESPERA_TOMOS_MS: 270000
});

function obtenerHojaSegura(nombreHoja) {
  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = spreadsheet.getSheetByName(nombreHoja);
  if (!sheet) {
    throw new Error("No se encontró la pestaña '" + nombreHoja + "'. Verifica el nombre.");
  }
  return sheet;
}

function extraerIdDeCeldaSegura(nombreHoja, celda) {
  var sheet = obtenerHojaSegura(nombreHoja);
  var range = sheet.getRange(celda);
  var candidatos = [];
  var richText = range.getRichTextValue();

  if (richText) {
    var runs = richText.getRuns();
    for (var i = 0; i < runs.length; i++) {
      var link = runs[i].getLinkUrl();
      if (link) candidatos.push(link);
    }
  }

  var formula = range.getFormula();
  if (formula) candidatos.push(formula);

  var display = range.getDisplayValue();
  if (display) candidatos.push(display);

  var rawValue = range.getValue();
  if (rawValue !== null && rawValue !== undefined) candidatos.push(String(rawValue));

  for (var c = 0; c < candidatos.length; c++) {
    var id = extraerIdGoogle_(candidatos[c]);
    if (id) return id;
  }

  return null;
}

function extraerIdGoogle_(contenido) {
  if (!contenido) return null;
  var texto = String(contenido).trim();
  if (!texto) return null;

  var patrones = [
    /\/folders\/([A-Za-z0-9_-]{20,})/,
    /\/d\/([A-Za-z0-9_-]{20,})/,
    /[?&]id=([A-Za-z0-9_-]{20,})/,
    /HYPERLINK\s*\(\s*["'].*?([A-Za-z0-9_-]{20,})/i
  ];

  for (var i = 0; i < patrones.length; i++) {
    var match = texto.match(patrones[i]);
    if (match) return match[1];
  }

  if (/^[A-Za-z0-9_-]{20,}$/.test(texto)) return texto;

  if (/drive\.google\.com|docs\.google\.com/i.test(texto)) {
    var generico = texto.match(/([A-Za-z0-9_-]{25,})/);
    if (generico) return generico[1];
  }

  return null;
}

function obtenerIdDesdeHoja(celda, nombreHoja) {
  var id = extraerIdDeCeldaSegura(nombreHoja, celda);
  if (!id) {
    throw new Error('No se encontró un enlace o ID válido en ' + nombreHoja + '!' + celda + '.');
  }
  return id;
}

function obtenerSubcarpetas(folderId) {
  try {
    var carpeta = DriveApp.getFolderById(folderId);
    var iterator = carpeta.getFolders();
    var lista = [];

    while (iterator.hasNext()) {
      var sub = iterator.next();
      lista.push({ id: sub.getId(), name: sub.getName() });
    }

    lista.sort(function(a, b) {
      return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
    });

    return lista;
  } catch (error) {
    throw new Error('No se pudo leer la carpeta ' + folderId + ': ' + error.message);
  }
}

function obtenerArchivosPdfDeCarpeta(folderId) {
  var carpeta = DriveApp.getFolderById(folderId);
  var files = carpeta.getFilesByType(MimeType.PDF);
  var lista = [];

  while (files.hasNext()) {
    var file = files.next();
    var nombre = file.getName();
    lista.push({
      id: file.getId(),
      name: nombre,
      paginas: extraerPaginasDelNombre_(nombre)
    });
  }

  lista.sort(function(a, b) {
    return a.name.localeCompare(b.name, 'es', { numeric: true, sensitivity: 'base' });
  });

  return lista;
}

function getOrCreateFolder(parentFolder, name, cache) {
  var nombre = String(name || '').trim();
  if (!nombre) throw new Error('Se intentó crear una carpeta sin nombre.');

  var cacheLocal = cache || {};
  var cacheKey = parentFolder.getId() + '::' + nombre.toUpperCase();
  if (cacheLocal[cacheKey]) return DriveApp.getFolderById(cacheLocal[cacheKey]);

  var existentes = parentFolder.getFoldersByName(nombre);
  if (existentes.hasNext()) {
    var encontrada = existentes.next();
    cacheLocal[cacheKey] = encontrada.getId();
    return encontrada;
  }

  var lock = LockService.getDocumentLock() || LockService.getScriptLock();
  if (!lock.tryLock(5000)) {
    throw new Error('No se pudo obtener el bloqueo para crear la carpeta: ' + nombre);
  }

  try {
    existentes = parentFolder.getFoldersByName(nombre);
    var carpeta = existentes.hasNext() ? existentes.next() : parentFolder.createFolder(nombre);
    cacheLocal[cacheKey] = carpeta.getId();
    return carpeta;
  } finally {
    lock.releaseLock();
  }
}

function normalizarTexto(texto) {
  if (texto === null || texto === undefined) return '';
  return String(texto)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim();
}

function simplificar(texto) {
  return normalizarTexto(texto).replace(/[^a-z0-9]/g, '');
}

function limpiarNombrePDF(nombre) {
  if (!nombre) return '';
  return String(nombre)
    .replace(/\.pdf$/i, '')
    .replace(/^(?:anexo\s+\d+(?:\.\d+)*\.?|\d+(?:\.\d+)*\.?)\s*[-–—.:]*\s*/i, '')
    .trim();
}

function extraerPrefijoAvanzado(nombre) {
  if (!nombre) return '';
  var match = String(nombre).match(/^(anexo\s+\d+(?:\.\d+)*\.?|\d+(?:\.\d+)*\.?)\s*/i);
  return match ? match[1].trim() : '';
}

function limpiarTextoSinPrefijoAvanzado(nombre) {
  if (!nombre) return '';
  return String(nombre)
    .replace(/^(anexo\s+\d+(?:\.\d+)*\.?|\d+(?:\.\d+)*\.?)\s*[-–—.:]*\s*/i, '')
    .trim();
}

function obtenerTextoVisual(nombre) {
  if (!nombre) return '';
  var texto = String(nombre).trim();
  var matchAnexo = texto.match(/^(ANEXO\s*\d+(?:\.\d+)*\.?)\s*[-–—.:]*\s*(.*)/i);

  if (matchAnexo) {
    return matchAnexo[1].toUpperCase() + (matchAnexo[2] ? '\n' + matchAnexo[2] : '');
  }

  var matchNum = texto.match(/^(\d+(?:\.\d+)*\.?)\s*[-–—.:]*\s*(.*)/);
  return matchNum ? matchNum[2] : texto;
}

function sanitizarNombreArchivo(nombre) {
  return String(nombre || '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function obtenerRutaDesdeOrigen(folderId, rootId) {
  var ruta = [];
  var actual = DriveApp.getFolderById(folderId);
  var visitados = {};
  var encontrado = actual.getId() === rootId;

  while (!encontrado) {
    if (visitados[actual.getId()]) {
      break;
    }
    visitados[actual.getId()] = true;

    var padres = actual.getParents();
    if (!padres.hasNext()) break;

    var padre = padres.next();
    if (padre.getId() === rootId) {
      encontrado = true;
      break;
    }

    ruta.unshift(padre.getName());
    actual = padre;
  }

  return ruta;
}

function filtrarSeleccionadosMasEspecificos(seleccionados) {
  if (!Array.isArray(seleccionados)) return [];

  var ids = {};
  seleccionados.forEach(function(item) {
    if (item && item.id) ids[item.id] = true;
  });

  var padresSeleccionados = {};

  seleccionados.forEach(function(item) {
    if (!item || !item.id) return;
    try {
      var actual = DriveApp.getFolderById(item.id);
      var seguridad = 0;

      while (seguridad++ < 100) {
        var padres = actual.getParents();
        if (!padres.hasNext()) break;
        var padre = padres.next();
        if (ids[padre.getId()]) padresSeleccionados[padre.getId()] = true;
        actual = padre;
      }
    } catch (error) {
      console.warn('No se pudo verificar la jerarquía de ' + item.id + ': ' + error.message);
    }
  });

  return seleccionados.filter(function(item) {
    return item && item.id && !padresSeleccionados[item.id];
  });
}

function listarPdfsRecursivo(carpeta, rutaInicial) {
  var salida = [];

  function recorrer(folder, ruta) {
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      salida.push({
        file: files.next(),
        parentFolder: folder,
        path: ruta.slice()
      });
    }

    var subs = [];
    var iterator = folder.getFolders();
    while (iterator.hasNext()) subs.push(iterator.next());
    subs.sort(function(a, b) {
      return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
    });

    subs.forEach(function(sub) {
      recorrer(sub, ruta.concat([sub.getName()]));
    });
  }

  recorrer(carpeta, rutaInicial || []);
  return salida;
}

// NUEVA FUNCIÓN: listarPdfsHastaNivel
function listarPdfsHastaNivel(carpeta, rutaInicial, nivelMaximo) {
  var salida = [];

  function recorrer(folder, ruta, nivelActual) {
    var files = folder.getFilesByType(MimeType.PDF);
    while (files.hasNext()) {
      salida.push({
        file: files.next(),
        parentFolder: folder,
        path: ruta.slice()
      });
    }

    if (nivelActual < nivelMaximo) {
      var subs = [];
      var iterator = folder.getFolders();
      while (iterator.hasNext()) subs.push(iterator.next());
      subs.sort(function(a, b) {
        return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
      });

      subs.forEach(function(sub) {
        recorrer(sub, ruta.concat([sub.getName()]), nivelActual + 1);
      });
    }
  }

  recorrer(carpeta, rutaInicial || [], 1);
  return salida;
}

function normalizarUrlEndpoint(url, endpoint) {
  var base = String(url || '').trim();
  if (!/^https?:\/\//i.test(base)) throw new Error('El enlace del servidor no es una URL HTTP/HTTPS válida.');

  base = base.replace(/\/+$/, '');
  var sufijo = '/' + String(endpoint || '').replace(/^\/+/, '');
  var regex = new RegExp(sufijo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$', 'i');

  return regex.test(base) ? base : base + sufijo;
}

function exportarGoogleWorkspaceAPdf(fileId) {
  var url = 'https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) +
    '/export?mimeType=' + encodeURIComponent('application/pdf');
  var ultimoError = null;

  for (var intento = 1; intento <= 3; intento++) {
    try {
      var respuesta = UrlFetchApp.fetch(url, {
        method: 'get',
        headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
        muteHttpExceptions: true
      });

      if (respuesta.getResponseCode() === 200) return respuesta.getBlob();
      ultimoError = new Error('Drive export devolvió HTTP ' + respuesta.getResponseCode() + '.');
    } catch (error) {
      ultimoError = error;
    }

    Utilities.sleep(200 * intento);
  }

  try {
    return DriveApp.getFileById(fileId).getAs(MimeType.PDF);
  } catch (fallbackError) {
    throw new Error('No se pudo exportar la plantilla a PDF: ' +
      (ultimoError ? ultimoError.message + ' / ' : '') + fallbackError.message);
  }
}

function esMimePlantillaValido(mimeType) {
  return mimeType === MimeType.GOOGLE_DOCS || mimeType === MimeType.GOOGLE_SLIDES;
}

function obtenerArchivoPlantillaDesdeId(id) {
  if (!id) throw new Error('No se proporcionó un ID de plantilla.');

  try {
    var archivo = DriveApp.getFileById(id);
    if (!esMimePlantillaValido(archivo.getMimeType())) {
      throw new Error('La plantilla debe ser un archivo de Google Docs o Google Slides.');
    }
    return archivo;
  } catch (errorArchivo) {
    try {
      var carpeta = DriveApp.getFolderById(id);
      var candidatos = [];
      var files = carpeta.getFiles();

      while (files.hasNext()) {
        var file = files.next();
        if (esMimePlantillaValido(file.getMimeType())) candidatos.push(file);
      }

      candidatos.sort(function(a, b) {
        return a.getName().localeCompare(b.getName(), 'es', { numeric: true, sensitivity: 'base' });
      });

      if (!candidatos.length) {
        throw new Error('La carpeta de plantillas no contiene Google Docs ni Google Slides.');
      }

      return candidatos[0];
    } catch (errorCarpeta) {
      throw new Error('No se pudo abrir la plantilla: ' + errorCarpeta.message);
    }
  }
}

function parsearJsonSeguro(texto) {
  try {
    return JSON.parse(texto || '{}');
  } catch (error) {
    return null;
  }
}

function escaparRegex(texto) {
  return String(texto || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function verificarServidor(nombreHoja, celda) {
  var sheet = obtenerHojaSegura(nombreHoja);
  var base = sheet.getRange(celda).getDisplayValue().trim();
  if (!base) throw new Error('No hay URL configurada en ' + nombreHoja + '!' + celda + '.');

  base = base.replace(/\/(compilar|tomos|health)\/?$/i, '').replace(/\/+$/, '');
  var respuesta = UrlFetchApp.fetch(base + '/health', {
    method: 'get',
    headers: { 'ngrok-skip-browser-warning': 'true' },
    muteHttpExceptions: true
  });

  var data = parsearJsonSeguro(respuesta.getContentText());
  if (respuesta.getResponseCode() !== 200 || !data || data.status !== 'ok') {
    throw new Error('El servidor no respondió correctamente. HTTP ' + respuesta.getResponseCode() + '.');
  }

  return { status: 'success', mensaje: '✅ Servidor activo y disponible.' };
}

function ejecutarFetchAllPorBloques_(solicitudes, tamanoBloque) {
  if (!Array.isArray(solicitudes)) {
    throw new Error('Las solicitudes HTTP deben recibirse como un arreglo.');
  }

  if (!solicitudes.length) return [];

  var limite = parseInt(tamanoBloque, 10);
  if (isNaN(limite) || limite < 1) limite = 1;

  var respuestas = [];

  for (var inicio = 0; inicio < solicitudes.length; inicio += limite) {
    var bloque = solicitudes.slice(inicio, inicio + limite);

    try {
      var respuestasBloque = UrlFetchApp.fetchAll(bloque);

      if (!respuestasBloque || respuestasBloque.length !== bloque.length) {
        throw new Error(
          'UrlFetchApp.fetchAll devolvió una cantidad inesperada de respuestas.'
        );
      }

      respuestas = respuestas.concat(respuestasBloque);

    } catch (errorBloque) {
      for (var i = 0; i < bloque.length; i++) {
        try {
          respuestas.push(ejecutarSolicitudHttpIndividual_(bloque[i]));
        } catch (errorIndividual) {
          respuestas.push(
            crearRespuestaHttpSintetica_(
              599,
              'Fallo de red al ejecutar la solicitud ' +
              (inicio + i + 1) +
              ': ' +
              errorIndividual.message +
              ' | Error inicial del bloque: ' +
              errorBloque.message
            )
          );
        }
      }
    }
  }

  return respuestas;
}

function ejecutarSolicitudHttpIndividual_(solicitud) {
  if (!solicitud || !solicitud.url) {
    throw new Error('La solicitud HTTP no contiene una URL válida.');
  }

  var opciones = {};

  Object.keys(solicitud).forEach(function(clave) {
    if (clave !== 'url') opciones[clave] = solicitud[clave];
  });

  return UrlFetchApp.fetch(solicitud.url, opciones);
}

function crearRespuestaHttpSintetica_(codigo, detalle) {
  var body = JSON.stringify({
    status: 'error',
    detail: String(detalle || 'Error HTTP no especificado.')
  });

  return {
    getResponseCode: function() {
      return Number(codigo) || 599;
    },
    getContentText: function() {
      return body;
    },
    getHeaders: function() {
      return {};
    }
  };
}

function obtenerValorConfigSistema_(clave, valorPredeterminado) {
  try {
    if (
      typeof CONFIG_SISTEMA !== 'undefined' &&
      CONFIG_SISTEMA &&
      CONFIG_SISTEMA[clave] !== undefined &&
      CONFIG_SISTEMA[clave] !== null &&
      CONFIG_SISTEMA[clave] !== ''
    ) {
      return CONFIG_SISTEMA[clave];
    }
  } catch (error) {
    // Se utiliza el valor predeterminado.
  }

  return valorPredeterminado;
}

function formatearNumeroMinimo_(valor, minimoDigitos) {
  var numero = Math.max(0, parseInt(valor, 10) || 0);
  var ancho = Math.max(1, parseInt(minimoDigitos, 10) || 1);
  var texto = String(numero);

  while (texto.length < ancho) texto = '0' + texto;
  return texto;
}

function listarArchivosExactos_(carpeta, nombreArchivo) {
  var salida = [];
  var iterator = carpeta.getFilesByName(String(nombreArchivo || ''));

  while (iterator.hasNext()) {
    var archivo = iterator.next();
    if (!archivo.isTrashed()) salida.push(archivo);
  }

  salida.sort(function(a, b) {
    return b.getDateCreated().getTime() - a.getDateCreated().getTime();
  });

  return salida;
}

function eliminarDuplicadosNombreExcepto_(carpeta, nombreArchivo, fileIdConservar) {
  var archivos = listarArchivosExactos_(carpeta, nombreArchivo);
  var eliminados = 0;

  archivos.forEach(function(archivo) {
    if (archivo.getId() === fileIdConservar) return;

    try {
      archivo.setTrashed(true);
      eliminados++;
    } catch (error) {
      console.warn(
        'No se pudo enviar a la papelera el duplicado ' +
        archivo.getName() + ': ' + error.message
      );
    }
  });

  return eliminados;
}

function crearArchivoSinDuplicados_(carpeta, blob, nombreArchivo) {
  if (!carpeta) throw new Error('No se indicó la carpeta de destino.');
  if (!blob) throw new Error('No se recibió el contenido del archivo.');

  var nombre = sanitizarNombreArchivo(nombreArchivo);
  if (!/\.pdf$/i.test(nombre)) nombre += '.pdf';

  blob.setName(nombre);

  var nuevo = carpeta.createFile(blob);
  eliminarDuplicadosNombreExcepto_(carpeta, nombre, nuevo.getId());
  return nuevo;
}

function guardarEstadoJsonFragmentado_(claveBase, objeto) {
  var propiedades = PropertiesService.getDocumentProperties();
  eliminarEstadoJsonFragmentado_(claveBase);

  var contenido = JSON.stringify(objeto || {});
  var tamano = 7000;
  var fragmentos = Math.max(1, Math.ceil(contenido.length / tamano));
  var valores = {};

  for (var i = 0; i < fragmentos; i++) {
    valores[claveBase + '_PARTE_' + i] = contenido.substring(i * tamano, (i + 1) * tamano);
  }

  valores[claveBase + '_META'] = JSON.stringify({
    fragmentos: fragmentos,
    longitud: contenido.length,
    actualizado: Date.now()
  });

  propiedades.setProperties(valores, false);
}

function leerEstadoJsonFragmentado_(claveBase) {
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
  if (Number(meta.longitud) !== contenido.length) return null;
  return parsearJsonSeguro(contenido);
}

function eliminarEstadoJsonFragmentado_(claveBase) {
  var propiedades = PropertiesService.getDocumentProperties();
  var meta = parsearJsonSeguro(propiedades.getProperty(claveBase + '_META'));

  if (meta && meta.fragmentos) {
    for (var i = 0; i < Number(meta.fragmentos); i++) {
      propiedades.deleteProperty(claveBase + '_PARTE_' + i);
    }
  }

  propiedades.deleteProperty(claveBase + '_META');
}

function obtenerHeadersServidor_(tokenOAuth) {
  var headers = {
    Authorization: 'Bearer ' + tokenOAuth,
    'ngrok-skip-browser-warning': 'true',
    'Bypass-Tunnel-Reminder': 'true'
  };

  var clave = String(obtenerValorConfigSistema_('CLAVE_SERVIDOR', '') || '').trim();
  if (clave) headers['X-Sistema-Maestro-Key'] = clave;
  return headers;
}

function enviarArchivosPapeleraPorId_(ids, idsConservar) {
  var conservar = {};
  (idsConservar || []).forEach(function(id) { conservar[String(id)] = true; });
  var eliminados = 0;

  (ids || []).forEach(function(id) {
    var valor = String(id || '').trim();
    if (!valor || conservar[valor]) return;
    try {
      var archivo = DriveApp.getFileById(valor);
      if (!archivo.isTrashed()) {
        archivo.setTrashed(true);
        eliminados++;
      }
    } catch (error) {
      console.warn('No se pudo enviar a la papelera el archivo ' + valor + ': ' + error.message);
    }
  });

  return eliminados;
}

// NUEVA FUNCIÓN: obtenerPaginasDePdf
function obtenerPaginasDePdf(idsArchivos) {
  var ids = Array.isArray(idsArchivos) ? idsArchivos : [idsArchivos];
  var resultados = [];

  ids.forEach(function(fileId) {
    try {
      var archivo = DriveApp.getFileById(fileId);
      if (archivo.getMimeType() !== MimeType.PDF) {
        try {
          archivo = archivo.getAs(MimeType.PDF);
        } catch (e) {
          throw new Error('El archivo no es PDF y no se pudo convertir.');
        }
      }

      var blob = archivo.getBlob();
      var bytes = blob.getBytes();
      var totalPaginas = 0;
      var CHUNK_SIZE = 512 * 1024; // 512 KB

      for (var i = 0; i < bytes.length; i += CHUNK_SIZE) {
        var chunk = bytes.slice(i, i + CHUNK_SIZE);
        var texto = '';
        for (var j = 0; j < chunk.length; j++) {
          texto += String.fromCharCode(chunk[j]);
        }
        var coincidencias = texto.match(/\/Type\s*\/Page[^s]/g);
        if (coincidencias) totalPaginas += coincidencias.length;
      }

      resultados.push({ id: fileId, paginas: totalPaginas });
    } catch (error) {
      console.warn('No se pudo contar páginas de ' + fileId + ': ' + error.message);
      resultados.push({ id: fileId, paginas: 0 });
    }
  });

  return resultados;
}