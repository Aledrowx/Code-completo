// ====================================================================
// ⚙️ SISTEMA MAESTRO UNIFICADO - MENÚ PRINCIPAL
// ====================================================================

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('🚀 Sistema Maestro')
    .addItem('Abrir Panel de Control', 'abrirSidebarMaestro')
    .addSeparator()
    .addItem('Restaurar carátulas base (modo original)', 'restaurarCaratulasBaseDesdeMenu')
    .addSeparator()
    .addItem('Autorizar y comprobar permisos', 'autorizarPermisos')
    .addToUi();
}

function abrirSidebarMaestro() {
  var html = HtmlService.createHtmlOutputFromFile('SidebarMaestro')
    .setWidth(560)
    .setHeight(700);

  SpreadsheetApp.getUi().showModelessDialog(html, 'Panel Maestro Integrado');
}

function restaurarCaratulasBaseDesdeMenu() {
  try {
    var resultado = restaurarCaratulasBase(null, 'original');
    SpreadsheetApp.getUi().alert(resultado.mensaje || String(resultado));
  } catch (error) {
    SpreadsheetApp.getUi().alert('No se pudo restaurar las carátulas:\n' + error.message);
  }
}

function autorizarPermisos() {
  try {
    DriveApp.getRootFolder().getName();
    ScriptApp.getOAuthToken();

    var respuesta = UrlFetchApp.fetch('https://www.google.com/generate_204', {
      muteHttpExceptions: true,
      followRedirects: true
    });

    if (respuesta.getResponseCode() >= 400) {
      throw new Error('La comprobación HTTP devolvió el código ' + respuesta.getResponseCode() + '.');
    }

    SpreadsheetApp.getUi().alert('Permisos autorizados y conexión externa comprobada correctamente.');
  } catch (error) {
    SpreadsheetApp.getUi().alert('No se pudieron completar los permisos:\n' + error.message);
    throw error;
  }
}
