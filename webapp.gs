// ====================================================================
// 🌐 WEB APP — Puerta de entrada como página independiente
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
  if (!usuario || !password) {
    throw new Error('Usuario y contraseña son obligatorios.');
  }

  var sheet = obtenerHojaSegura('USUARIOS');
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

function generarHashDeClavePrueba() {
  Logger.log(calcularHashClave_('CAMBIA_ESTO_por_tu_clave'));
}

function registrarAuditoria_(nombreHoja, usuario, accion) {
  try {
    var sheet = obtenerHojaSegura(nombreHoja);
    sheet.appendRow([
      new Date(), 'Auditoría - Panel Web',
      'Usuario: ' + (usuario || 'desconocido'), accion || '', '', ''
    ]);
  } catch (err) {
    Logger.log('No se pudo registrar auditoría: ' + err.message);
  }
}

function wCrearCarpetaLibre(usuario, nombreCarpeta) {
  var resultado = crearCarpetaLibre(nombreCarpeta);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_COMPILADOS, usuario, 'Crear carpeta libre: ' + nombreCarpeta);
  return resultado;
}

function wProcesarSeleccionados(usuario, lote, configUbicacion, configCaratula) {
  var resultado = procesarSeleccionados(lote, configUbicacion, configCaratula);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_COMPILADOS, usuario, 'Carátulas: ' + (resultado.mensaje || ''));
  return resultado;
}

function wRestaurarCaratulasBase(usuario, idPlantillaElegida, tipoCaratulaElegido) {
  var resultado = restaurarCaratulasBase(idPlantillaElegida, tipoCaratulaElegido);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_COMPILADOS, usuario, 'Restaurar carátulas base: ' + (resultado.mensaje || ''));
  return resultado;
}

function wProcesarCompilacionSegunModo(usuario, seleccionados, metodo, config) {
  var resultado = procesarCompilacionSegunModo(seleccionados, metodo, config);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_COMPILADOS, usuario, 'Compilador: ' + (resultado.mensaje || ''));
  return resultado;
}

function wHerramienta1_Calcular(usuario, seleccionados, config) {
  var resultado = herramienta1_Calcular(seleccionados, config);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_TOMOS, usuario, 'Tomos - Proyectar: ' + (resultado.mensaje || ''));
  return resultado;
}

function wHerramienta2_Caratulas(usuario, seleccionados, config) {
  var resultado = herramienta2_Caratulas(seleccionados, config);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_TOMOS, usuario, 'Tomos - Índices: ' + (resultado.mensaje || ''));
  return resultado;
}

function wHerramienta3_GenerarTomos(usuario, seleccionados, config) {
  var resultado = herramienta3_GenerarTomos(seleccionados, config);
  registrarAuditoria_(CONFIG_SISTEMA.HOJA_TOMOS, usuario, 'Tomos - Fusionar: ' + (resultado.mensaje || ''));
  return resultado;
}

function obtenerConfiguracionPanel(nombreHoja) {
  var sheet = obtenerHojaSegura(nombreHoja);
  var valores = sheet.getRange('B2:C8').getDisplayValues();
  return valores.map(function(fila) {
    return { label: fila[0] || '', value: fila[1] || '' };
  });
}

function obtenerHistorialPanel(nombreHoja) {
  var sheet = obtenerHojaSegura(nombreHoja);
  var ultimaFila = sheet.getLastRow();
  if (ultimaFila < 15) return [];
  var filas = sheet.getRange(15, 1, ultimaFila - 14, 6).getDisplayValues();
  filas = filas.filter(function(f) { return f.some(function(c) { return c !== ''; }); });
  filas.reverse();
  return filas.slice(0, 100);
}

function borrarHistorialPanel(nombreHoja) {
  var sheet = obtenerHojaSegura(nombreHoja);
  var ultimaFila = sheet.getLastRow();
  if (ultimaFila < 15) {
    return { status: 'success', mensaje: 'No hay registros para borrar.' };
  }
  var numFilas = ultimaFila - 14;
  sheet.getRange(15, 1, numFilas, 6).clearContent();
  return { status: 'success', mensaje: 'Historial borrado (' + numFilas + ' filas).' };
}