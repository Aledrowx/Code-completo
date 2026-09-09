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





// ====================================================================
// 🔎 DIAGNÓSTICO COMPLETO DE CARÁTULAS
// ====================================================================
//
// USO:
// 1. Agrega este bloque al final de Compilador.gs
// 2. Guarda.
// 3. Ejecuta: diagnosticarCaratulasAnexo11()
// 4. Hazlo primero con TU cuenta.
// 5. Luego hazlo con la cuenta de la otra persona.
//
// NO genera PDFs.
// NO modifica Drive.
// NO modifica Sheets.
// SOLO LEE Y MUESTRA INFORMACIÓN.
// ====================================================================

function diagnosticarCaratulasAnexo11() {

  var resultado = {
    status: 'success',
    hoja: '',
    idC4: '',
    carpetaC4: '',
    totalCaratulas: 0,
    busquedas: [],
    todasLasCaratulas: [],
    error: ''
  };


  try {

    // ================================================================
    // 1. OBTENER HOJA PRINCIPAL
    // ================================================================

    var nombreHoja =
      CONFIG_SISTEMA.HOJA_COMPILADOS;

    resultado.hoja = nombreHoja;


    console.log(
      '=================================================='
    );

    console.log(
      '🔎 DIAGNÓSTICO DE CARÁTULAS'
    );

    console.log(
      '=================================================='
    );

    console.log(
      'Hoja: ' + nombreHoja
    );


    // ================================================================
    // 2. OBTENER C4
    // ================================================================

    var idC4 =
      obtenerIdDesdeHoja(
        'C4',
        nombreHoja
      );

    resultado.idC4 = idC4;


    console.log(
      'ID C4: ' + idC4
    );


    if (!idC4) {

      throw new Error(
        'C4 no contiene un ID de carpeta válido.'
      );
    }


    // ================================================================
    // 3. ABRIR C4
    // ================================================================

    var carpetaC4 =
      DriveApp.getFolderById(
        idC4
      );


    resultado.carpetaC4 =
      carpetaC4.getName();


    console.log(
      'Carpeta C4: ' +
      carpetaC4.getName()
    );


    console.log(
      'URL C4: ' +
      carpetaC4.getUrl()
    );


    // ================================================================
    // 4. OBTENER TODAS LAS CARÁTULAS
    // ================================================================

    var caratulas =
      extraerTodasLasCaratulas_(
        carpetaC4
      );


    resultado.totalCaratulas =
      caratulas.length;


    console.log(
      'TOTAL DE CARÁTULAS ENCONTRADAS: ' +
      caratulas.length
    );


    // ================================================================
    // 5. MOSTRAR TODAS
    // ================================================================

    console.log(
      '--------------------------------------------------'
    );

    console.log(
      '📂 TODAS LAS CARÁTULAS ENCONTRADAS'
    );

    console.log(
      '--------------------------------------------------'
    );


    caratulas.forEach(
      function(caratula, indice) {

        var dato = {

          numero:
            indice + 1,

          nombre:
            caratula.name,

          id:
            caratula.id,

          nameNorm:
            caratula.nameNorm
        };


        resultado.todasLasCaratulas.push(
          dato
        );


        console.log(
          (indice + 1) +
          '. ' +
          caratula.name
        );

        console.log(
          '   ID: ' +
          caratula.id
        );
      }
    );


    // ================================================================
    // 6. PATRONES QUE EL COMPILADOR BUSCA
    // ================================================================

    var patrones = [

      {
        nombre:
          'FICHA DIAGNOSTICO',

        patron:
          'memoria diagnostico'
      },

      {
        nombre:
          'FICHA DIAGNOSTICO ALTERNATIVO',

        patron:
          'ficha diagnostico'
      },

      {
        nombre:
          'PLANOS DIAGNOSTICO',

        patron:
          'planos diagnostico'
      },

      {
        nombre:
          'RENIEC',

        patron:
          'reniec'
      },

      {
        nombre:
          'RUC',

        patron:
          'ruc'
      },

      {
        nombre:
          'DECLARACION JURADA',

        patron:
          'declaracion jurada'
      },

      {
        nombre:
          'PARTIDA REGISTRAL',

        patron:
          'partida registral'
      },

      {
        nombre:
          'CONSTANCIA DE POSESION',

        patron:
          'constancia de posesion'
      },

      {
        nombre:
          'CERTIFICADO DE BUSQUEDA',

        patron:
          'certificado de busqueda'
      },

      {
        nombre:
          'INFORME TECNICO',

        patron:
          'informe tecnico'
      }

    ];


    // ================================================================
    // 7. BUSCAR CADA CARÁTULA
    // ================================================================

    console.log(
      '=================================================='
    );

    console.log(
      '🔍 RESULTADO DE LAS BÚSQUEDAS'
    );

    console.log(
      '=================================================='
    );


    patrones.forEach(
      function(item) {

        var encontrada =
          buscarCaratulaPorNombreExactoContiene_(
            caratulas,
            item.patron
          );


        var resultadoBusqueda = {

          nombre:
            item.nombre,

          patron:
            item.patron,

          encontrada:
            Boolean(encontrada),

          id:
            encontrada
              ? encontrada.id
              : '',

          archivo:
            encontrada
              ? encontrada.name
              : ''
        };


        resultado.busquedas.push(
          resultadoBusqueda
        );


        if (encontrada) {

          console.log(
            '✅ ' +
            item.nombre +
            ' → ' +
            encontrada.name
          );

          console.log(
            '   ID: ' +
            encontrada.id
          );

        } else {

          console.warn(
            '❌ ' +
            item.nombre +
            ' → NO ENCONTRADA'
          );
        }

      }
    );


    // ================================================================
    // 8. VERIFICACIÓN ESPECIAL DE ANEXO 11
    // ================================================================

    console.log(
      '=================================================='
    );

    console.log(
      '📋 VERIFICACIÓN ANEXO 11'
    );

    console.log(
      '=================================================='
    );


    var anexo11 =
      caratulas.filter(
        function(caratula) {

          var nombre =
            normalizarTexto(
              caratula.name
            );

          return (
            nombre.indexOf(
              'diag'
            ) !== -1
            ||
            nombre.indexOf(
              'planos'
            ) !== -1
            ||
            nombre.indexOf(
              'reniec'
            ) !== -1
          );
        }
      );


    console.log(
      'Carátulas relacionadas con Anexo 11: ' +
      anexo11.length
    );


    anexo11.forEach(
      function(caratula) {

        console.log(
          '→ ' +
          caratula.name
        );
      }
    );


    // ================================================================
    // 9. INFORMACIÓN FINAL
    // ================================================================

    console.log(
      '=================================================='
    );

    console.log(
      '✅ DIAGNÓSTICO FINALIZADO'
    );

    console.log(
      '=================================================='
    );

    console.log(
      'Total carátulas: ' +
      resultado.totalCaratulas
    );


    // ================================================================
    // 10. DEVOLVER RESULTADO
    // ================================================================

    return resultado;


  } catch (error) {

    resultado.status = 'error';

    resultado.error =
      error &&
      error.message
        ? error.message
        : String(error);


    console.error(
      '❌ ERROR EN DIAGNÓSTICO: ' +
      resultado.error
    );


    return resultado;
  }
}
