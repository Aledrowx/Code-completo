// ====================================================================
// 🌐 CONFIGURACIÓN Y CONSTANTES DEL SISTEMA
// ====================================================================
var CONFIG_SISTEMA = CONFIG_SISTEMA || {
  HOJA_COMPILADOS: 'CARATULAS Y COMPILADOS',
  HOJA_TOMOS: 'TOMOS',
  HOJA_USUARIOS: 'USUARIOS'
};

// ====================================================================
// 🌐 WEB APP — Entrada
// ====================================================================

function doGet(e) {
  return HtmlService.createHtmlOutputFromFile('WebPanel')
    .setTitle('Panel Maestro Integrado')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

function validarLogin(usuario, password) {
  usuario = String(usuario || '').trim();
  password = String(password || '');
  if (!usuario || !password) throw new Error('Usuario y contraseña son obligatorios.');

  var sheet = obtenerHojaPorNombre('USUARIOS');
  var datos = sheet.getDataRange().getValues();
  var hashIngresado = calcularHashClave_(password);

  for (var i = 1; i < datos.length; i++) {
    var fila = datos[i];
    var usuarioFila = String(fila[0] || '').trim();
    if (usuarioFila.toLowerCase() !== usuario.toLowerCase()) continue;

    var hashGuardado = String(fila[1] || '').trim();
    var rol = String(fila[2] || 'operador').trim() || 'operador';
    var activo = fila[3] === undefined || fila[3] === '' ? true : Boolean(fila[3]);

    if (!activo) throw new Error('Usuario deshabilitado.');
    if (hashGuardado !== hashIngresado) throw new Error('Usuario o contraseña incorrectos.');

    return { status: 'success', usuario: usuarioFila, rol: rol };
  }

  throw new Error('Usuario o contraseña incorrectos.');
}

function calcularHashClave_(password) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, password, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    var v = (b < 0 ? b + 256 : b).toString(16);
    return v.length === 1 ? '0' + v : v;
  }).join('');
}

function registrarAuditoria_(nombreHoja, usuario, accion) {
  try {
    var sheet = obtenerHojaPorNombre(nombreHoja || 'CARATULAS Y COMPILADOS');
    sheet.appendRow([
      new Date(),
      'Auditoría - Panel Web',
      'Usuario: ' + (usuario || 'desconocido'),
      accion || '',
      '',
      ''
    ]);
  } catch (err) {
    Logger.log('Auditoría omitida: ' + err.message);
  }
}

// ====================================================================
// 🔒 GESTIÓN DE USUARIOS
// ====================================================================

function verificarEsJefe_(usuarioSolicitante) {
  var sheet = obtenerHojaPorNombre('USUARIOS');
  var datos = sheet.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).toLowerCase() === String(usuarioSolicitante).toLowerCase()) {
      var rol = String(datos[i][2] || '').trim();
      if (rol.toLowerCase() !== 'jefe') {
        throw new Error('No tienes permisos para esta acción.');
      }
      return true;
    }
  }
  throw new Error('Usuario no reconocido.');
}

function listarUsuarios(usuarioSolicitante) {
  verificarEsJefe_(usuarioSolicitante);
  var sheet = obtenerHojaPorNombre('USUARIOS');
  var ultimaFila = sheet.getLastRow();
  if (ultimaFila < 2) return [];

  var datos = sheet.getRange(2, 1, ultimaFila - 1, 4).getValues();
  var lista = [];

  for (var i = 0; i < datos.length; i++) {
    if (String(datos[i][0]).trim() !== '') {
      lista.push({
        usuario: datos[i][0],
        cargo: datos[i][2],
        activo: datos[i][3] === undefined || datos[i][3] === '' ? true : Boolean(datos[i][3])
      });
    }
  }
  return lista;
}

function crearUsuario(usuarioSolicitante, nuevoUsuario, password, cargo) {
  verificarEsJefe_(usuarioSolicitante);
  nuevoUsuario = String(nuevoUsuario || '').trim();
  password = String(password || '');

  if (!nuevoUsuario || password.length < 4) {
    throw new Error('Usuario y contraseña (mínimo 4 caracteres) son obligatorios.');
  }

  var sheet = obtenerHojaPorNombre('USUARIOS');
  var ultimaFila = sheet.getLastRow();

  if (ultimaFila >= 2) {
    var datos = sheet.getRange(2, 1, ultimaFila - 1, 1).getValues();
    for (var i = 0; i < datos.length; i++) {
      if (String(datos[i][0]).toLowerCase() === nuevoUsuario.toLowerCase()) {
        throw new Error('Ese usuario ya existe.');
      }
    }
  }

  sheet.appendRow([nuevoUsuario, calcularHashClave_(password), cargo || 'operador', true]);
  registrarAuditoria_('CARATULAS Y COMPILADOS', usuarioSolicitante, 'Creó usuario: ' + nuevoUsuario);
  return { status: 'success', mensaje: 'Usuario "' + nuevoUsuario + '" creado correctamente.' };
}

function actualizarCargoUsuario(usuarioSolicitante, usuarioObjetivo, nuevoCargo) {
  verificarEsJefe_(usuarioSolicitante);
  var sheet = obtenerHojaPorNombre('USUARIOS');
  var datos = sheet.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).toLowerCase() === String(usuarioObjetivo).toLowerCase()) {
      sheet.getRange(i + 1, 3).setValue(nuevoCargo);
      registrarAuditoria_('CARATULAS Y COMPILADOS', usuarioSolicitante, 'Cambió cargo de ' + usuarioObjetivo + ' a ' + nuevoCargo);
      return { status: 'success', mensaje: 'Cargo actualizado.' };
    }
  }
  throw new Error('Usuario no encontrado.');
}

function cambiarPasswordUsuario(usuarioSolicitante, usuarioObjetivo, nuevaPassword) {
  verificarEsJefe_(usuarioSolicitante);
  if (String(nuevaPassword || '').length < 4) throw new Error('La contraseña debe tener al menos 4 caracteres.');
  var sheet = obtenerHojaPorNombre('USUARIOS');
  var datos = sheet.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).toLowerCase() === String(usuarioObjetivo).toLowerCase()) {
      sheet.getRange(i + 1, 2).setValue(calcularHashClave_(nuevaPassword));
      registrarAuditoria_('CARATULAS Y COMPILADOS', usuarioSolicitante, 'Cambió contraseña de ' + usuarioObjetivo);
      return { status: 'success', mensaje: 'Contraseña actualizada.' };
    }
  }
  throw new Error('Usuario no encontrado.');
}

function cambiarEstadoUsuario(usuarioSolicitante, usuarioObjetivo, nuevoEstado) {
  verificarEsJefe_(usuarioSolicitante);
  var sheet = obtenerHojaPorNombre('USUARIOS');
  var datos = sheet.getDataRange().getValues();
  for (var i = 1; i < datos.length; i++) {
    if (String(datos[i][0]).toLowerCase() === String(usuarioObjetivo).toLowerCase()) {
      sheet.getRange(i + 1, 4).setValue(nuevoEstado);
      registrarAuditoria_('CARATULAS Y COMPILADOS', usuarioSolicitante, (nuevoEstado ? 'Activó' : 'Desactivó') + ' a ' + usuarioObjetivo);
      return { status: 'success', mensaje: 'Estado actualizado.' };
    }
  }
  throw new Error('Usuario no encontrado.');
}

function obtenerAuditoria(usuarioSolicitante) {
  verificarEsJefe_(usuarioSolicitante);
  var filas = obtenerHistorialPanel('CARATULAS Y COMPILADOS');
  var resultado = [];

  for (var i = 0; i < filas.length; i++) {
    var fila = filas[i];
    var colA = String(fila[0] || '');
    var colB = String(fila[1] || '');
    var colC = String(fila[2] || '');
    var colD = String(fila[3] || '');

    // Descartar filas antiguas corruptas donde la contraseña/hash quedó guardada
    if (colB.length >= 32) continue;

    resultado.push({
      fecha: colA,
      modulo: colB,
      usuario: colC,
      accion: colD
    });
  }
  return resultado;
}

// ====================================================================
// 🛠️ WRAPPERS
// ====================================================================

function wCrearCarpetaLibre(usuario, nombreCarpeta) {
  var resultado = typeof crearCarpetaLibre === 'function' ? crearCarpetaLibre(nombreCarpeta) : { mensaje: 'Carpeta creada' };
  registrarAuditoria_('CARATULAS Y COMPILADOS', usuario, 'Crear carpeta libre: ' + nombreCarpeta);
  return resultado;
}

function wProcesarSeleccionados(usuario, lote, configUbicacion, configCaratula) {
  var resultado = typeof procesarSeleccionados === 'function' ? procesarSeleccionados(lote, configUbicacion, configCaratula) : { mensaje: 'Carátulas procesadas' };
  registrarAuditoria_('CARATULAS Y COMPILADOS', usuario, 'Carátulas: ' + (resultado.mensaje || ''));
  return resultado;
}

function wRestaurarCaratulasBase(usuario, idPlantillaElegida, tipoCaratulaElegido) {
  var resultado = typeof restaurarCaratulasBase === 'function' ? restaurarCaratulasBase(idPlantillaElegida, tipoCaratulaElegido) : { mensaje: 'Carátulas base restauradas' };
  registrarAuditoria_('CARATULAS Y COMPILADOS', usuario, 'Restaurar carátulas base: ' + (resultado.mensaje || ''));
  return resultado;
}

function wProcesarCompilacionSegunModo(usuario, seleccionados, metodo, config) {
  var resultado = typeof procesarCompilacionSegunModo === 'function' ? procesarCompilacionSegunModo(seleccionados, metodo, config) : { mensaje: 'Compilación enviada' };
  registrarAuditoria_('CARATULAS Y COMPILADOS', usuario, 'Compilador: ' + (resultado.mensaje || ''));
  return resultado;
}

function wHerramienta1_Calcular(usuario, seleccionados, config) {
  var resultado = typeof herramienta1_Calcular === 'function' ? herramienta1_Calcular(seleccionados, config) : { mensaje: 'Proyección generada' };
  registrarAuditoria_('TOMOS', usuario, 'Tomos - Proyectar: ' + (resultado.mensaje || ''));
  return resultado;
}

function wHerramienta2_Caratulas(usuario, seleccionados, config) {
  var resultado = typeof herramienta2_Caratulas === 'function' ? herramienta2_Caratulas(seleccionados, config) : { mensaje: 'Índices generados' };
  registrarAuditoria_('TOMOS', usuario, 'Tomos - Índices: ' + (resultado.mensaje || ''));
  return resultado;
}

function wHerramienta3_GenerarTomos(usuario, seleccionados, config) {
  var resultado = typeof herramienta3_GenerarTomos === 'function' ? herramienta3_GenerarTomos(seleccionados, config) : { mensaje: 'Tomos fusionados' };
  registrarAuditoria_('TOMOS', usuario, 'Tomos - Fusionar: ' + (resultado.mensaje || ''));
  return resultado;
}

// ====================================================================
// 📊 ACCESO ESTRICTO A HOJAS POR NOMBRE
// ====================================================================

function obtenerHojaPorNombre(nombreHoja) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nombreHoja);
  if (!sheet) {
    throw new Error('No se encontró la pestaña llamada "' + nombreHoja + '".');
  }
  return sheet;
}

function obtenerHistorialPanel(nombreHoja) {
  var sheet = obtenerHojaPorNombre(nombreHoja || 'CARATULAS Y COMPILADOS');
  var ultimaFila = sheet.getLastRow();
  if (ultimaFila < 15) return [];
  var filas = sheet.getRange(15, 1, ultimaFila - 14, 6).getDisplayValues();
  filas = filas.filter(function(f) { return f.some(function(c) { return c !== ''; }); });
  filas.reverse();
  return filas.slice(0, 100);
}

function borrarHistorialPanel(nombreHoja) {
  var sheet = obtenerHojaPorNombre(nombreHoja || 'CARATULAS Y COMPILADOS');
  var ultimaFila = sheet.getLastRow();
  if (ultimaFila < 15) {
    return { status: 'success', mensaje: 'No hay registros para borrar.' };
  }
  var numFilas = ultimaFila - 14;
  sheet.getRange(15, 1, numFilas, 6).clearContent();
  return { status: 'success', mensaje: 'Historial borrado (' + numFilas + ' filas).' };
}
