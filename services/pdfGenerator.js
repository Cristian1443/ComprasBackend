// ============================================================
// GENERADOR DE PDFs PARA FIRMA
// ------------------------------------------------------------
// Crea los PDFs que se envían a Adobe Sign según la etapa:
//  - formato_planeacion: para Gerente, Financiera, Jurídica
//  - acta_comite: para Comité (Directora + Secretaria)
//
// Usa pdfkit (no requiere Chromium ni Puppeteer).
// Los PDFs son simples pero contienen todos los datos relevantes
// + un bloque de firma al final.
// ============================================================

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';

const COLOR_NARANJA = '#E84922';
const COLOR_AZUL = '#1f4e79';
const COLOR_GRIS = '#1f2937';
const COLOR_GRIS_CLARO = '#6b7280';

/**
 * Genera el PDF del Formato de Planeación Contractual.
 * @param {object} solicitud - Datos completos de la solicitud.
 * @param {string} etapa - gerente | financiera | juridica
 * @param {string} destinoPath - Ruta absoluta de salida.
 * @returns {Promise<string>} Ruta del PDF generado.
 */
export function generarPdfFormatoPlaneacion(solicitud, etapa, destinoPath) {
    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(path.dirname(destinoPath), { recursive: true });
            const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
                Title: `Formato de Planeación - ${solicitud.codigo}`,
                Author: 'Invest in Bogotá',
                Subject: 'Formato de Planeación Contractual',
            }});
            const stream = fs.createWriteStream(destinoPath);
            doc.pipe(stream);

            // ───── Cabecera ─────
            doc.fillColor(COLOR_NARANJA)
                .fontSize(18)
                .font('Helvetica-Bold')
                .text('FORMATO DE PLANEACIÓN CONTRACTUAL', { align: 'left' });
            doc.fillColor(COLOR_GRIS_CLARO)
                .fontSize(10)
                .font('Helvetica')
                .text(`Invest in Bogotá · ${solicitud.codigo || 'Sin código'}`, { align: 'left' });
            doc.moveDown(0.4);

            // Línea separadora
            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(COLOR_NARANJA).lineWidth(1.5).stroke();
            doc.moveDown(0.8);

            // ───── Datos generales ─────
            seccion(doc, 'Información general');
            fila(doc, 'Objeto:', solicitud.objeto || '—');
            fila(doc, 'Solicitante:', solicitud.solicitante_nombre || '—');
            fila(doc, 'Gerencia:', solicitud.gerencia_nombre || '—');
            fila(doc, 'Modalidad:', String(solicitud.modalidad || '—').toUpperCase());
            fila(doc, 'Lugar de ejecución:', solicitud.lugar_ejecucion || '—');
            fila(doc, 'Plazo:', plazoTexto(solicitud));
            fila(doc, 'Fecha de solicitud:', formatearFecha(solicitud.creado_en));

            // ───── Presupuesto ─────
            doc.moveDown(0.5);
            seccion(doc, 'Presupuesto');
            fila(doc, 'Valor estimado:', valorTexto(solicitud));
            if (solicitud.presupuesto_aprobado) {
                fila(doc, 'Presupuesto aprobado:', `${solicitud.moneda || 'COP'} ${formatNum(solicitud.presupuesto_aprobado)}`);
                fila(doc, 'Rubro presupuestal:', solicitud.rubro || solicitud.rubro_presupuestal || '—');
            }

            // ───── Justificación ─────
            doc.moveDown(0.5);
            seccion(doc, 'Justificación');
            parrafo(doc, solicitud.justificacion || solicitud.descripcion_necesidad_detalle || 'No registrada.');

            // ───── Causal de contratación (si directa) ─────
            if (String(solicitud.modalidad || '').toLowerCase() === 'directa') {
                doc.moveDown(0.5);
                seccion(doc, 'Causal de contratación');
                parrafo(doc, mapearCausal(solicitud.modalidad_seleccion) || solicitud.justificacion_cd || 'No registrada.');
            }

            // ───── Aprobación previa ─────
            doc.moveDown(0.5);
            seccion(doc, 'Aprobaciones previas');
            if (solicitud.fecha_respuesta_gerente && etapa !== 'gerente') {
                fila(doc, 'Aprobado por Gerente:', `${solicitud.gerente_nombre || '—'} · ${formatearFecha(solicitud.fecha_respuesta_gerente)}`);
            }
            if (solicitud.fecha_respuesta_financiera && etapa !== 'financiera') {
                fila(doc, 'Aprobado por Financiera:', `${solicitud.financiera_nombre || '—'} · ${formatearFecha(solicitud.fecha_respuesta_financiera)}`);
            }
            if (solicitud.resultado_comite && etapa !== 'comite') {
                fila(doc, 'Decisión Comité:', `${String(solicitud.resultado_comite).toUpperCase()} · ${formatearFecha(solicitud.fecha_comite_decision)}`);
            }

            // ───── Bloque de firma ─────
            doc.moveDown(2);
            bloqueFirma(doc, etapa, solicitud);

            // ───── Pie ─────
            doc.fontSize(8).fillColor(COLOR_GRIS_CLARO)
                .text(`F38-MA-GAF-02 V01 · Generado el ${formatearFechaHora(new Date())}`,
                    40, doc.page.height - 50, { align: 'center', width: 515 });

            doc.end();
            stream.on('finish', () => resolve(destinoPath));
            stream.on('error', reject);
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Genera el PDF del Acta de Comité (firma Directora + Secretaria).
 */
export function generarPdfActaComite({ solicitud, actaNumero, fechaSesion, participantes, discusion, decision, destinoPath }) {
    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(path.dirname(destinoPath), { recursive: true });
            const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
                Title: `Acta Comité ${actaNumero} - ${solicitud.codigo}`,
                Author: 'Invest in Bogotá',
            }});
            const stream = fs.createWriteStream(destinoPath);
            doc.pipe(stream);

            doc.fillColor(COLOR_AZUL).fontSize(20).font('Helvetica-Bold')
                .text('ACTA DE COMITÉ DE CONTRATACIÓN', { align: 'center' });
            doc.fillColor(COLOR_GRIS_CLARO).fontSize(11).font('Helvetica')
                .text(`Sesión Nº ${actaNumero}`, { align: 'center' });
            doc.text(formatearFecha(fechaSesion || new Date()), { align: 'center' });
            doc.moveDown(1);

            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(COLOR_AZUL).lineWidth(2).stroke();
            doc.moveDown(0.8);

            // Participantes
            seccion(doc, 'Participantes del comité');
            (participantes || []).forEach((p, i) => {
                doc.fontSize(10).fillColor(COLOR_GRIS).font('Helvetica')
                    .text(`${i + 1}. ${p.nombre}${p.cargo ? ` — ${p.cargo}` : ''}${p.representaA ? ` (reemplaza a ${p.representaA})` : ''}`);
            });

            // Solicitud discutida
            doc.moveDown(0.8);
            seccion(doc, 'Solicitud evaluada');
            fila(doc, 'Código:', solicitud.codigo || '—');
            fila(doc, 'Objeto:', solicitud.objeto || '—');
            fila(doc, 'Solicitante:', solicitud.solicitante_nombre || '—');
            fila(doc, 'Gerencia:', solicitud.gerencia_nombre || '—');
            fila(doc, 'Monto:', valorTexto(solicitud));
            fila(doc, 'Modalidad:', String(solicitud.modalidad || '—').toUpperCase());

            // Discusión
            doc.moveDown(0.8);
            seccion(doc, 'Discusión del comité');
            parrafo(doc, discusion || 'Sin observaciones registradas.');

            // Decisión
            doc.moveDown(0.5);
            seccion(doc, 'Decisión');
            const decisionLabel = decision === 'aprobada' ? 'APROBADA'
                : decision === 'rechazada' ? 'RECHAZADA'
                : decision === 'en_revision' ? 'EN REVISIÓN' : '—';
            const decisionColor = decision === 'aprobada' ? '#065F46'
                : decision === 'rechazada' ? '#991B1B'
                : '#92400E';
            doc.fontSize(14).fillColor(decisionColor).font('Helvetica-Bold').text(decisionLabel);

            // Bloque firma (Directora + Secretaria)
            doc.moveDown(2);
            bloqueFirmaComite(doc);

            // Pie
            doc.fontSize(8).fillColor(COLOR_GRIS_CLARO)
                .text(`Acta ${actaNumero} · Generado el ${formatearFechaHora(new Date())}`,
                    40, doc.page.height - 50, { align: 'center', width: 515 });

            doc.end();
            stream.on('finish', () => resolve(destinoPath));
            stream.on('error', reject);
        } catch (e) {
            reject(e);
        }
    });
}

const COLOR_ROJO_RA15 = '#D0312D';
const COLOR_AMBAR_RA15 = '#F5A623';

/**
 * Genera el PDF "RA1-5 Evaluación de Proveedores" con la calificación
 * capturada por el supervisor, listo para enviar a Adobe Sign (el
 * supervisor del contrato firma el documento).
 *
 * @param {object} opts
 * @param {object} opts.solicitud - Fila de v_solicitudes_resumen (incluye titulo_contrato, supervision_nombre)
 * @param {object} opts.evaluacion - Fila de evaluaciones_proveedor (criterios, total, observaciones, etc.)
 * @param {string} opts.destinoPath
 */
export function generarPdfEvaluacionProveedor({ solicitud, evaluacion, destinoPath }) {
    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(path.dirname(destinoPath), { recursive: true });
            const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
                Title: `RA1-5 Evaluación de Proveedores - ${solicitud.codigo}`,
                Author: 'Invest in Bogotá',
                Subject: 'Evaluación de Proveedores',
            }});
            const stream = fs.createWriteStream(destinoPath);
            doc.pipe(stream);

            const X = 40, ANCHO = 515; // 595.28pt (A4) - 2*40 de margen

            // ───── 1. Cabecera: título + logo (igual que el formulario web) ─────
            const leftW = 350, rightW = ANCHO - leftW, headerH = 58;
            const headerY = doc.y;
            doc.lineWidth(1.5).strokeColor('#999999');
            doc.rect(X, headerY, leftW, headerH).stroke();
            doc.rect(X + leftW, headerY, rightW, headerH).stroke();

            doc.fillColor('#1f2937').fontSize(13).font('Helvetica-Bold')
                .text('RA1-5 EVALUACIÓN DE', X + 14, headerY + 12, { width: leftW - 28 });
            doc.text('PROVEEDORES', X + 14, headerY + 28, { width: leftW - 28 });

            const grupoW = 116, grupoX = X + leftW + (rightW - grupoW) / 2, circleR = 20;
            const circleCx = grupoX + 76, circleCy = headerY + headerH / 2;
            doc.fillColor('#333333').fontSize(9).font('Helvetica')
                .text('Invest in', grupoX, circleCy - 5, { width: 70 });
            doc.fillColor(COLOR_ROJO_RA15).circle(circleCx, circleCy, circleR).fill();
            doc.fillColor('#fff').fontSize(7.5).font('Helvetica-Bold')
                .text('Bogotá', circleCx - circleR, circleCy - 4, { width: circleR * 2, align: 'center' });

            doc.y = headerY + headerH + 12;
            doc.fillColor(COLOR_GRIS_CLARO).fontSize(9).font('Helvetica')
                .text(`Invest in Bogotá · ${solicitud.codigo || 'Sin código'}`, X, doc.y);
            doc.moveDown(0.8);

            // ───── 2. Datos del contrato ─────
            let y = doc.y;
            y = filaTabla(doc, {
                x: X, y, labelW: 206, valueW: ANCHO - 206,
                label: 'Título de la contratación:', value: solicitud.titulo_contrato || solicitud.objeto || '—',
                labelBg: COLOR_ROJO_RA15, labelColor: '#fff', valueColor: COLOR_GRIS,
            });
            y = filaTabla(doc, {
                x: X, y, labelW: 206, valueW: ANCHO - 206,
                label: 'Tipo de contratación:', value: String(solicitud.modalidad || '—').toUpperCase(),
                labelBg: COLOR_ROJO_RA15, labelColor: '#fff', valueColor: COLOR_GRIS,
            });
            y = filaTabla(doc, {
                x: X, y, labelW: 206, valueW: ANCHO - 206,
                label: 'Proveedor:', value: evaluacion.nombre_proveedor || '—',
                labelBg: COLOR_ROJO_RA15, labelColor: '#fff', valueColor: COLOR_GRIS,
            });
            y = filaTabla(doc, {
                x: X, y, labelW: 206, valueW: ANCHO - 206,
                label: 'No. de contrato u orden asociado:', value: solicitud.codigo || '—',
                labelBg: COLOR_ROJO_RA15, labelColor: '#fff', valueColor: COLOR_GRIS,
            });
            y = filaTabla(doc, {
                x: X, y, labelW: 206, valueW: ANCHO - 206,
                label: 'Correo electrónico del proveedor:', value: evaluacion.correo_proveedor || '—',
                labelBg: COLOR_ROJO_RA15, labelColor: '#fff', valueColor: COLOR_GRIS,
            });
            y = filaTabla(doc, {
                x: X, y, labelW: 206, valueW: ANCHO - 206,
                label: 'Fecha de evaluación:', value: formatearFecha(evaluacion.fecha_evaluacion),
                labelBg: COLOR_ROJO_RA15, labelColor: '#fff', valueColor: COLOR_GRIS,
            });
            y += 10;

            // ───── 3. Banner "Calificación" + instrucciones ─────
            const bannerH = 20;
            doc.rect(X, y, ANCHO, bannerH).fillAndStroke(COLOR_ROJO_RA15, '#fff');
            doc.fillColor('#fff').fontSize(11).font('Helvetica-Bold')
                .text('CALIFICACIÓN', X, y + 5, { width: ANCHO, align: 'center' });
            y += bannerH;

            const instruccion = 'Evalúe de uno a diez donde uno es muy insatisfecho y diez muy satisfecho';
            doc.fontSize(9).font('Helvetica');
            const instruccionH = doc.heightOfString(instruccion, { width: ANCHO - 20, align: 'center' }) + 14;
            doc.rect(X, y, ANCHO, instruccionH).strokeColor('#ccc').lineWidth(0.5).stroke();
            doc.fillColor(COLOR_GRIS)
                .text(instruccion, X + 10, y + 7, { width: ANCHO - 20, align: 'center' });
            y += instruccionH + 6;

            // ───── 4. Tabla de criterios ─────
            const criterios = Array.isArray(evaluacion.criterios) ? evaluacion.criterios : [];
            const colW1 = 380, colW2 = ANCHO - colW1, filaPad = 7;

            // Encabezado tabla
            doc.rect(X, y, colW1, 22).fillAndStroke(COLOR_ROJO_RA15, '#fff');
            doc.rect(X + colW1, y, colW2, 22).fillAndStroke(COLOR_ROJO_RA15, '#fff');
            doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
                .text('Aspectos para evaluar', X + 8, y + 7, { width: colW1 - 16 });
            doc.text('Puntaje obtenido', X + colW1, y + 7, { width: colW2, align: 'center' });
            y += 22;

            criterios.forEach((c) => {
                const nombre = c.nombre || '—';
                doc.fontSize(9).font('Helvetica');
                const textoH = doc.heightOfString(nombre, { width: colW1 - 16 });
                const rowH = Math.max(22, textoH + filaPad * 2);

                doc.rect(X, y, colW1, rowH).strokeColor('#ccc').lineWidth(0.5).stroke();
                doc.rect(X + colW1, y, colW2, rowH).strokeColor('#ccc').lineWidth(0.5).stroke();
                doc.fillColor(COLOR_GRIS).font('Helvetica')
                    .text(nombre, X + 8, y + filaPad, { width: colW1 - 16 });
                doc.font('Helvetica-Bold')
                    .text(String(c.puntaje ?? '0'), X + colW1, y + filaPad, { width: colW2, align: 'center' });
                y += rowH;
            });

            // Fila total
            doc.rect(X, y, colW1, 24).fillAndStroke(COLOR_ROJO_RA15, '#fff');
            doc.rect(X + colW1, y, colW2, 24).fillAndStroke(COLOR_AMBAR_RA15, '#fff');
            doc.fillColor('#fff').fontSize(9).font('Helvetica-Bold')
                .text('Resultado ponderado máximo 100', X + 8, y + 8, { width: colW1 - 16 });
            doc.fontSize(11)
                .text(Number(evaluacion.total || 0).toFixed(2), X + colW1, y + 7, { width: colW2, align: 'center' });
            y += 24 + 10;

            // ───── 5. Estado del proveedor ─────
            const total = Number(evaluacion.total || 0);
            const estado = total >= 80 ? 'Proveedor aprobado'
                : total >= 70 ? 'Proveedor en observación'
                : 'Proveedor rechazado — bloqueado para futuros contratos';
            const estadoColor = total >= 80 ? '#15803d' : total >= 70 ? '#b45309' : '#b91c1c';
            y = filaTabla(doc, {
                x: X, y, labelW: 180, valueW: ANCHO - 180,
                label: 'Estado:', value: estado,
                labelBg: COLOR_AMBAR_RA15, labelColor: '#fff', valueColor: estadoColor, valueBold: true,
            });
            y += 10;

            // ───── 6. Observaciones ─────
            doc.rect(X, y, ANCHO, bannerH).fillAndStroke(COLOR_ROJO_RA15, '#fff');
            doc.fillColor('#fff').fontSize(11).font('Helvetica-Bold')
                .text('OBSERVACIONES', X, y + 5, { width: ANCHO, align: 'center' });
            y += bannerH;

            const obsTexto = evaluacion.observaciones || 'Sin observaciones adicionales.';
            doc.fontSize(10).font('Helvetica');
            const obsH = Math.max(50, doc.heightOfString(obsTexto, { width: ANCHO - 20 }) + 16);
            doc.rect(X, y, ANCHO, obsH).strokeColor('#ccc').lineWidth(0.5).stroke();
            doc.fillColor(COLOR_GRIS).text(obsTexto, X + 10, y + 8, { width: ANCHO - 20, align: 'justify' });
            y += obsH + 20;

            doc.y = y;
            if (doc.y > doc.page.height - 175) doc.addPage();

            // ───── 7. Firma electrónica del supervisor ─────
            doc.fillColor(COLOR_GRIS).fontSize(11).font('Helvetica-Bold').text('FIRMA DEL SUPERVISOR DESIGNADO', X, doc.y);
            doc.moveDown(0.3);
            doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica')
                .text('El supervisor del contrato certifica la evaluación realizada al proveedor. Se firma electrónicamente.', X, doc.y, {
                    width: ANCHO, align: 'justify',
                });
            doc.moveDown(1.5);

            // Fuente grande en el tag para que Adobe Sign dimensione un
            // campo de firma más grande, y más espacio vertical antes de
            // la línea para que el trazo de la firma no quede apretado.
            const ySig = doc.y;
            doc.fontSize(24).fillColor('#000000').font('Helvetica').text('{{Sig_es_:signer1:signature}}', 60, ySig);
            doc.moveTo(60, ySig + 60).lineTo(400, ySig + 60).strokeColor('#000').lineWidth(0.5).stroke();
            doc.fontSize(9).fillColor(COLOR_GRIS_CLARO).text('Firma electrónica', 60, ySig + 66, { width: 340 });
            doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica-Bold')
                .text(solicitud.supervision_nombre || 'Supervisor designado', 60, ySig + 79, { width: 340 });
            doc.fontSize(9).fillColor(COLOR_GRIS_CLARO).font('Helvetica').text('Supervisor del contrato', 60, ySig + 93, { width: 340 });

            // Pie
            doc.fontSize(8).fillColor(COLOR_GRIS_CLARO)
                .text(`RA1-5 · Generado el ${formatearFechaHora(new Date())}`,
                    40, doc.page.height - 50, { align: 'center', width: 515 });

            doc.end();
            stream.on('finish', () => resolve(destinoPath));
            stream.on('error', reject);
        } catch (e) {
            reject(e);
        }
    });
}

/**
 * Dibuja una fila de dos celdas (label coloreado + valor) con altura
 * calculada dinámicamente según el texto más alto de las dos celdas,
 * para evitar solapamientos cuando el label o el valor se parten en
 * varias líneas. Devuelve el nuevo valor de `y` tras la fila.
 */
function filaTabla(doc, { x, y, labelW, valueW, label, value, labelBg, labelColor, valueColor, valueBold, fontSize = 9 }) {
    const pad = 8;
    doc.font('Helvetica-Bold').fontSize(fontSize);
    const labelH = doc.heightOfString(label, { width: labelW - pad * 2, align: 'center' });
    doc.font(valueBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize);
    const valueH = doc.heightOfString(String(value ?? '—') || '—', { width: valueW - pad * 2 });
    const rowH = Math.max(labelH, valueH) + pad * 2;

    doc.rect(x, y, labelW, rowH).fillAndStroke(labelBg, '#fff');
    doc.rect(x + labelW, y, valueW, rowH).strokeColor('#ccc').lineWidth(0.5).stroke();

    doc.fillColor(labelColor).font('Helvetica-Bold').fontSize(fontSize)
        .text(label, x + pad, y + pad, { width: labelW - pad * 2, align: 'center' });
    doc.fillColor(valueColor).font(valueBold ? 'Helvetica-Bold' : 'Helvetica').fontSize(fontSize)
        .text(String(value ?? '—') || '—', x + labelW + pad, y + pad, { width: valueW - pad * 2 });

    return y + rowH;
}

// ============================================================
// Helpers de layout
// ============================================================

function seccion(doc, titulo) {
    doc.fillColor(COLOR_NARANJA).fontSize(11).font('Helvetica-Bold').text(titulo.toUpperCase());
    doc.moveTo(40, doc.y + 1).lineTo(200, doc.y + 1).strokeColor('#FDBA74').lineWidth(0.7).stroke();
    doc.moveDown(0.3);
}

function fila(doc, label, valor) {
    const y = doc.y;
    doc.fillColor(COLOR_GRIS_CLARO).fontSize(9).font('Helvetica-Bold')
        .text(label, 40, y, { width: 130, continued: false });
    doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica')
        .text(valor || '—', 175, y, { width: 380 });
    doc.moveDown(0.15);
}

function parrafo(doc, texto) {
    doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica')
        .text(String(texto || '—'), { align: 'justify', lineGap: 2 });
}

function bloqueFirma(doc, etapa, solicitud) {
    const rol = etapa === 'gerente' ? 'Gerente de Área'
        : etapa === 'financiera' ? 'Jefe de Financiera'
        : etapa === 'juridica' ? 'Área Jurídica'
        : 'Aprobador';

    const fechaKey = etapa === 'gerente' ? 'fecha_respuesta_gerente'
        : etapa === 'financiera' ? 'fecha_respuesta_financiera'
        : etapa === 'juridica' ? 'fecha_respuesta_juridica'
        : null;
    const nombreKey = etapa === 'gerente' ? 'gerente_nombre'
        : etapa === 'financiera' ? 'financiera_nombre'
        : etapa === 'juridica' ? 'juridica_nombre'
        : null;

    doc.fillColor(COLOR_GRIS).fontSize(11).font('Helvetica-Bold')
        .text('CONSTANCIA DE APROBACIÓN', { align: 'left' });
    doc.moveDown(0.3);
    doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica')
        .text(`El ${rol} certifica la revisión y aprobación de la información contenida en este formato. La aprobación queda registrada con estampa de tiempo en el sistema.`, {
            align: 'justify',
        });
    doc.moveDown(1);

    const y = doc.y;
    const boxW = 220;
    const boxH = 72;
    doc.roundedRect(60, y, boxW, boxH, 6).lineWidth(1.5).strokeColor(COLOR_AZUL).stroke();
    doc.fontSize(9).fillColor(COLOR_AZUL).font('Helvetica-Bold')
        .text('APROBADO', 60, y + 10, { width: boxW, align: 'center' });
    doc.fontSize(10).fillColor(COLOR_GRIS).font('Helvetica-Bold')
        .text(nombreKey ? (solicitud[nombreKey] || '—') : '—', 60, y + 26, { width: boxW, align: 'center' });
    doc.fontSize(9).fillColor(COLOR_GRIS_CLARO).font('Helvetica')
        .text(rol, 60, y + 42, { width: boxW, align: 'center' });
    const fechaTexto = fechaKey && solicitud[fechaKey]
        ? formatearFechaHora(solicitud[fechaKey])
        : formatearFechaHora(new Date());
    doc.fontSize(8).fillColor(COLOR_GRIS_CLARO).font('Helvetica')
        .text(fechaTexto, 60, y + 56, { width: boxW, align: 'center' });
    doc.y = y + boxH + 12;
}

function bloqueFirmaComite(doc) {
    doc.fillColor(COLOR_GRIS).fontSize(11).font('Helvetica-Bold')
        .text('FIRMAS DEL COMITÉ');
    doc.moveDown(0.3);
    doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica')
        .text('Se firma electrónicamente por la Directora y la Secretaria del Comité de Contratación.', {
            align: 'justify',
        });
    doc.moveDown(2);

    const y = doc.y;
    // Columna izq (Directora)
    doc.fontSize(11).fillColor('#000000').font('Helvetica')
        .text('{{Sig_es_:signer1:signature}}', 60, y);
    doc.moveTo(60, y + 30).lineTo(260, y + 30).strokeColor('#000').lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor(COLOR_GRIS_CLARO)
        .text('Firma electrónica', 60, y + 35, { width: 200 });
    doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica-Bold')
        .text('Directora', 60, y + 47, { width: 200 });
    doc.fontSize(9).fillColor(COLOR_GRIS_CLARO).font('Helvetica')
        .text('Comité de Contratación', 60, y + 60, { width: 200 });

    // Columna der (Secretaria)
    doc.fontSize(11).fillColor('#000000').font('Helvetica')
        .text('{{Sig_es_:signer2:signature}}', 310, y);
    doc.moveTo(310, y + 30).lineTo(510, y + 30).strokeColor('#000').lineWidth(0.5).stroke();
    doc.fontSize(9).fillColor(COLOR_GRIS_CLARO)
        .text('Firma electrónica', 310, y + 35, { width: 200 });
    doc.fillColor(COLOR_GRIS).fontSize(10).font('Helvetica-Bold')
        .text('Secretaria del Comité', 310, y + 47, { width: 200 });
    doc.fontSize(9).fillColor(COLOR_GRIS_CLARO).font('Helvetica')
        .text('Comité de Contratación', 310, y + 60, { width: 200 });
}

// ============================================================
// Helpers de formato
// ============================================================

function formatNum(n) {
    const num = Number(n) || 0;
    return new Intl.NumberFormat('es-CO').format(num);
}

function valorTexto(s) {
    const m = String(s.moneda || 'COP').toUpperCase();
    const texto = m === 'USD' ? s.valor_moneda_usd_texto
        : m === 'EUR' ? s.valor_moneda_eur_texto
        : s.valor_moneda_cop_texto;
    if (texto) return `${m} ${texto}`;
    return `${m} ${formatNum(s.valor_en_cop || s.valor_estimado || 0)}`;
}

function plazoTexto(s) {
    const m = s.plazo_ejecucion_meses || 0;
    const d = s.plazo_ejecucion_dias || 0;
    if (!m && !d) return 'No especificado';
    const parts = [];
    if (m) parts.push(`${m} ${m === 1 ? 'mes' : 'meses'}`);
    if (d) parts.push(`${d} ${d === 1 ? 'día' : 'días'}`);
    return parts.join(' · ');
}

function formatearFecha(iso) {
    if (!iso) return '—';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatearFechaHora(iso) {
    const d = iso instanceof Date ? iso : new Date(iso);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleDateString('es-CO') + ' · ' + d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
}

const CAUSALES = {
    i: 'I. No existen otros proveedores (proveedor exclusivo / propiedad intelectual).',
    iii_a: 'III. Convocatoria desierta por dos veces consecutivas.',
    iv: 'IV. Especialidad - Intuito Personae.',
    v: 'V. Disponibilidad continua (alojamiento/transporte).',
    vi: 'VI. Suscripción a publicaciones.',
    vii: 'VII. Arrendamiento de inmuebles.',
    viii: 'VIII. Productos financieros y seguros.',
    ix: 'IX. Capacitaciones y SG-SST.',
    x: 'X. Urgencia manifiesta.',
};

function mapearCausal(codigo) {
    if (!codigo) return null;
    return CAUSALES[String(codigo).toLowerCase()] || String(codigo);
}

/**
 * Genera el PDF del acta de comité para múltiples solicitudes en una sola sesión.
 * @param {object} opts
 * @param {{ solicitud: object, discusion: string, decision: string }[]} opts.solicitudes
 * @param {string} opts.actaNumero
 * @param {string|Date} opts.fechaSesion
 * @param {{ nombre: string, cargo: string, representaA?: string }[]} opts.participantes
 * @param {string} opts.destinoPath
 */
export function generarPdfActaComiteMultiple({ solicitudes, actaNumero, fechaSesion, participantes, destinoPath }) {
    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(path.dirname(destinoPath), { recursive: true });
            const doc = new PDFDocument({ size: 'A4', margin: 40, info: {
                Title: `Acta Comité ${actaNumero}`,
                Author: 'Invest in Bogotá',
            }});
            const stream = fs.createWriteStream(destinoPath);
            doc.pipe(stream);

            doc.fillColor(COLOR_AZUL).fontSize(18).font('Helvetica-Bold')
                .text('ACTA DE COMITÉ DE CONTRATACIÓN', { align: 'center' });
            doc.fillColor(COLOR_GRIS_CLARO).fontSize(11).font('Helvetica')
                .text(`Sesión Nº ${actaNumero}`, { align: 'center' });
            doc.text(formatearFecha(fechaSesion || new Date()), { align: 'center' });
            doc.moveDown(1);

            doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor(COLOR_AZUL).lineWidth(2).stroke();
            doc.moveDown(0.8);

            // Participantes
            seccion(doc, 'Participantes del comité');
            (participantes || []).forEach((p, i) => {
                doc.fontSize(10).fillColor(COLOR_GRIS).font('Helvetica')
                    .text(`${i + 1}. ${p.nombre}${p.cargo ? ` — ${p.cargo}` : ''}${p.representaA ? ` (reemplaza a ${p.representaA})` : ''}`);
            });

            // Solicitudes
            solicitudes.forEach(({ solicitud, discusion, decision }, idx) => {
                doc.moveDown(1);
                doc.moveTo(40, doc.y).lineTo(555, doc.y).strokeColor('#E5E7EB').lineWidth(0.5).stroke();
                doc.moveDown(0.5);

                doc.fillColor(COLOR_AZUL).fontSize(12).font('Helvetica-Bold')
                    .text(`Solicitud ${idx + 1}: ${solicitud.objeto || '—'}`);
                doc.moveDown(0.3);

                fila(doc, 'Código:', solicitud.codigo || '—');
                fila(doc, 'Solicitante:', solicitud.solicitante_nombre || '—');
                fila(doc, 'Gerencia:', solicitud.gerencia_nombre || '—');
                fila(doc, 'Monto:', valorTexto(solicitud));
                fila(doc, 'Modalidad:', String(solicitud.modalidad || '—').toUpperCase());

                doc.moveDown(0.5);
                seccion(doc, 'Discusión');
                parrafo(doc, discusion || 'Sin observaciones registradas.');

                doc.moveDown(0.3);
                seccion(doc, 'Decisión');
                const decisionLabel = decision === 'aprobada' ? 'APROBADA'
                    : decision === 'rechazada' ? 'RECHAZADA'
                    : decision === 'en_revision' ? 'EN REVISIÓN' : '—';
                const decisionColor = decision === 'aprobada' ? '#065F46'
                    : decision === 'rechazada' ? '#991B1B'
                    : '#92400E';
                doc.fontSize(12).fillColor(decisionColor).font('Helvetica-Bold').text(decisionLabel);
            });

            // Bloque de firmas
            doc.moveDown(2);
            bloqueFirmaComite(doc);

            doc.fontSize(8).fillColor(COLOR_GRIS_CLARO)
                .text(`Acta ${actaNumero} · Generado el ${formatearFechaHora(new Date())}`,
                    40, doc.page.height - 50, { align: 'center', width: 515 });

            doc.end();
            stream.on('finish', () => resolve(destinoPath));
            stream.on('error', reject);
        } catch (e) {
            reject(e);
        }
    });
}

export default {
    generarPdfFormatoPlaneacion,
    generarPdfActaComite,
    generarPdfActaComiteMultiple,
    generarPdfEvaluacionProveedor,
};
