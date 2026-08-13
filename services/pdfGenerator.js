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
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.join(__dirname, '..', 'assets');

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
 * Genera el PDF del Acta de Comité — réplica fiel del acta oficial que se ve
 * en pantalla y se imprime (membrete, Asistentes/Invitados, Orden del día,
 * Desarrollo, ficha técnica por solicitud, Conclusión y cierre, firmas).
 *
 * @param {object} opts
 * @param {{ solicitud: object, discusion: string, decision: string }[]} opts.solicitudes
 * @param {string} opts.actaNumero
 * @param {string|Date} opts.fechaSesion
 * @param {object[]} opts.participantes - { nombre, cargo, representaA?, tipo: 'asistente'|'invitado' }
 * @param {string} [opts.desarrollo] - Texto libre de la sección "Desarrollo"
 * @param {string} [opts.conclusion] - Texto libre de la sección "Conclusión y cierre"
 * @param {{ nombre: string, cargo: string }[]} opts.firmantes - [Directora, Secretaria]
 * @param {string} opts.destinoPath
 */
export function generarPdfActaComite({ solicitudes, actaNumero, fechaSesion, participantes, desarrollo, conclusion, firmantes, destinoPath }) {
    return new Promise((resolve, reject) => {
        try {
            fs.mkdirSync(path.dirname(destinoPath), { recursive: true });
            const doc = new PDFDocument({
                size: 'A4', margin: 40, bufferPages: true, info: {
                    Title: `Acta Comité ${actaNumero}`,
                    Author: 'Invest in Bogotá',
                },
            });
            const stream = fs.createWriteStream(destinoPath);
            doc.pipe(stream);

            doc.on('pageAdded', () => {
                dibujarEncabezadoActa(doc);
                doc.y = 110;
            });
            dibujarEncabezadoActa(doc);
            doc.y = 110;

            const fecha = fechaSesion ? new Date(fechaSesion) : new Date();
            const fechaLarga = fecha.toLocaleDateString('es-CO', {
                weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
            });
            const fechaCapitalizada = fechaLarga.charAt(0).toUpperCase() + fechaLarga.slice(1);
            const hora = fecha.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });

            doc.fillColor('#000000').fontSize(13).font('Helvetica-Bold')
                .text(`ACTA No. ${actaNumero} COMITÉ DE CONTRATACIÓN`, { align: 'center' });
            doc.moveDown(0.3);
            doc.fontSize(11).font('Helvetica-Bold')
                .text('REUNIÓN DEL COMITÉ DE CONTRATACIÓN DE LA CORPORACIÓN PARA EL DESARROLLO Y '
                    + 'LA PRODUCTIVIDAD BOGOTÁ REGIÓN - REGIÓN DINÁMICA - INVEST IN BOGOTÁ', { align: 'center' });
            doc.moveDown(0.8);

            doc.fontSize(11).font('Helvetica').fillColor('#000000')
                .text(`En la ciudad de Bogotá, el ${fechaCapitalizada}, siendo las ${hora}, se reunió el `
                    + 'Comité de Contratación de la Corporación para el Desarrollo y la Productividad, '
                    + 'Bogotá - Región Invest in Bogotá (en adelante, IIB), de manera presencial. '
                    + 'Esta sesión se llevó a cabo previa convocatoria de la Jefe Administrativa y de '
                    + 'Talento Humano delegada por la Directora Ejecutiva, conforme a lo dispuesto en '
                    + 'la Política de Compras y Contratación.', { align: 'justify' });
            doc.moveDown(0.6);

            const todosParticipantes = participantes || [];
            const asistentes = todosParticipantes.filter((p) => (p.tipo ? p.tipo === 'asistente' : !p.esInvitado));
            const invitados = todosParticipantes.filter((p) => (p.tipo ? p.tipo === 'invitado' : !!p.esInvitado));

            if (asistentes.length > 0) {
                doc.font('Helvetica-Bold').fontSize(11).text('Asistentes:');
                asistentes.forEach((p) => {
                    doc.font('Helvetica').text(`${p.nombre} – ${p.cargo}${p.representaA ? ` (en representación de ${p.representaA})` : ''}`);
                });
                doc.moveDown(0.4);
            }
            if (invitados.length > 0) {
                doc.font('Helvetica-Bold').fontSize(11).text('Invitados:');
                invitados.forEach((p) => {
                    doc.font('Helvetica').text(`${p.nombre} – ${p.cargo}`);
                });
                doc.moveDown(0.4);
            }

            listaOrdenada(doc, ['Orden del día', 'Contexto y discusión caso', 'Conclusión y cierre']);

            doc.moveDown(0.3);
            doc.font('Helvetica-Bold').fontSize(11).text('Desarrollo:');
            doc.moveDown(0.2);
            if (String(desarrollo || '').trim()) {
                String(desarrollo).split(/\n{2,}|\n/).filter((par) => par.trim()).forEach((par) => {
                    parrafo(doc, par.trim());
                });
            }

            listaOrdenada(doc, solicitudes.map(({ solicitud }, i) => solicitud.titulo_contrato || solicitud.objeto || `Solicitud ${i + 1}`));

            solicitudes.forEach(({ solicitud, discusion }, idx) => {
                doc.moveDown(0.6);
                doc.font('Helvetica-Bold').fontSize(11).text(`Solicitud N. ${idx + 1}`);
                doc.text(solicitud.titulo_contrato || solicitud.objeto || 'Sin objeto registrado');
                doc.moveDown(0.2);

                const origenPpto = solicitud.rubro || solicitud.rubro_presupuestal || solicitud.gerencia_nombre || 'N/A';
                const supervisor = solicitud.supervision_nombre || solicitud.solicitante_nombre || 'N/A';
                doc.font('Helvetica').fontSize(11);
                filaBold(doc, 'Monto:', montoActaTexto(solicitud));
                filaBold(doc, 'Plazo:', plazoTexto(solicitud));
                filaBold(doc, 'Origen de PPTO:', origenPpto);
                filaBold(doc, 'Supervisor Contrato:', supervisor);
                filaBold(doc, 'Causal de contratación:', causalComiteTexto(solicitud) || 'No registrada');
                doc.moveDown(0.3);

                doc.font('Helvetica-Bold').text('Contexto y descripción de la necesidad:');
                parrafo(doc, solicitud.justificacion || solicitud.descripcion_necesidad_detalle || 'Sin descripción registrada.');

                doc.font('Helvetica-Bold').text('Discusión');
                parrafo(doc, discusion || '—');
            });

            doc.moveDown(0.6);
            doc.font('Helvetica-Bold').fontSize(11).text('2.   Conclusión y cierre');
            doc.moveDown(0.2);
            if (String(conclusion || '').trim()) {
                String(conclusion).split(/\n{2,}|\n/).filter((par) => par.trim()).forEach((par) => {
                    parrafo(doc, par.trim());
                });
            }

            listaOrdenada(doc, solicitudes.map(({ solicitud }, i) => solicitud.objeto || `Solicitud ${i + 1}`));

            doc.moveDown(1);
            doc.font('Helvetica').fontSize(11).text('En constancia firman:');
            doc.moveDown(1.2);

            if (doc.y > doc.page.height - 160) doc.addPage();
            bloqueFirmaComite(doc, firmantes || []);

            const rango = doc.bufferedPageRange();
            for (let i = rango.start; i < rango.start + rango.count; i++) {
                doc.switchToPage(i);
                dibujarPieActa(doc, actaNumero);
            }

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

function bloqueFirmaComite(doc, firmantes) {
    const directora = firmantes[0] || { nombre: '___________________________', cargo: 'Directora de Comité' };
    const secretaria = firmantes[1] || { nombre: '___________________________', cargo: 'Secretaria de Comité' };

    const y = doc.y;
    // Columna izq (Directora) — el tag {{Sig_es_:signerN:signature}} lo reemplaza
    // Adobe Sign por el campo de firma real; el texto no queda visible en el PDF final.
    doc.fontSize(11).fillColor('#000000').font('Helvetica')
        .text('{{Sig_es_:signer1:signature}}', 60, y, { width: 200 });
    doc.moveTo(60, y + 52).lineTo(260, y + 52).strokeColor('#1f2937').lineWidth(1.5).stroke();
    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
        .text(directora.nombre, 60, y + 57, { width: 200 });
    doc.fontSize(11).fillColor('#000000').font('Helvetica')
        .text(directora.cargo, 60, y + 73, { width: 200 });

    // Columna der (Secretaria)
    doc.fontSize(11).fillColor('#000000').font('Helvetica')
        .text('{{Sig_es_:signer2:signature}}', 310, y, { width: 200 });
    doc.moveTo(310, y + 52).lineTo(510, y + 52).strokeColor('#1f2937').lineWidth(1.5).stroke();
    doc.fillColor('#000000').fontSize(11).font('Helvetica-Bold')
        .text(secretaria.nombre, 310, y + 57, { width: 200 });
    doc.fontSize(11).fillColor('#000000').font('Helvetica')
        .text(secretaria.cargo, 310, y + 73, { width: 200 });

    doc.y = y + 95;
}

/** Dibuja el membrete institucional (logo IIB arriba a la derecha) en la página actual. */
function dibujarEncabezadoActa(doc) {
    try {
        const logoPath = path.join(ASSETS_DIR, 'logo-iib-oficial.png');
        if (fs.existsSync(logoPath)) {
            doc.image(logoPath, doc.page.width - 40 - 90, 28, { width: 90 });
        }
    } catch { /* si falla el logo, seguimos sin membrete */ }
}

/** Dibuja el pie institucional (silueta de Bogotá + datos de contacto + código de documento). */
function dibujarPieActa(doc, actaNumero) {
    const y = doc.page.height - 66;
    try {
        const skylinePath = path.join(ASSETS_DIR, 'bogota-skyline.png');
        if (fs.existsSync(skylinePath)) {
            doc.image(skylinePath, 40, y - 4, { height: 36 });
        }
    } catch { /* ignorar si falla la imagen */ }
    doc.fontSize(7.5).fillColor(COLOR_NARANJA).font('Helvetica-Bold')
        .text('Agencia de promoción de inversión y eventos', 130, y, { width: 340 });
    doc.fontSize(7.5).fillColor(COLOR_GRIS_CLARO).font('Helvetica')
        .text('Calle 67 # 8-32/44; piso 4; Bogotá, D.C.  ·  (+57) 317 7806158  ·  www.investinbogota.org', 130, y + 10, { width: 340 });
    doc.fontSize(7).fillColor(COLOR_GRIS_CLARO)
        .text(`F13-PR-GD-01. V02. · Acta ${actaNumero}`, 40, doc.page.height - 22);
}

/** Lista numerada simple (1. 2. 3. ...). */
function listaOrdenada(doc, items) {
    doc.font('Helvetica').fontSize(11).fillColor('#000000');
    (items || []).forEach((texto, i) => {
        doc.text(`${i + 1}. ${texto}`, { indent: 8 });
    });
    doc.moveDown(0.3);
}

/** Fila "Etiqueta: valor" en una sola línea, etiqueta en negrita. */
function filaBold(doc, label, value) {
    doc.font('Helvetica-Bold').text(label, { continued: true }).font('Helvetica').text(`  ${value ?? '—'}`);
}

/** Monto del acta: usa presupuesto certificado si existe, si no el valor estimado (igual que en pantalla). */
function montoActaTexto(s) {
    if (s.presupuesto_aprobado != null && !Number.isNaN(Number(s.presupuesto_aprobado)) && Number(s.presupuesto_aprobado) > 0) {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(s.presupuesto_aprobado));
    }
    const monedaSol = String(s.moneda || 'COP').toUpperCase();
    const texto = monedaSol === 'USD' ? s.valor_moneda_usd_texto
        : monedaSol === 'EUR' ? s.valor_moneda_eur_texto
        : s.valor_moneda_cop_texto;
    if (texto) return `${monedaSol} ${texto}`;
    const monto = Number(s.valor_en_cop || s.valor_estimado || 0);
    const currency = monedaSol === 'COMBINADA' ? 'COP' : monedaSol;
    try {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency, maximumFractionDigits: 0 }).format(monto);
    } catch {
        return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(monto);
    }
}

/** Causal de contratación mostrada en el acta — mismo texto largo que ve Secretaría en pantalla. */
const CAUSALES_DIRECTA_LARGO = {
    i: 'I. Cuando no existen otros proveedores para el suministro del bien y/o servicio por ser titular de derechos de propiedad intelectual o por ser proveedor exclusivo en el territorio nacional.',
    ii: 'II. Cuando por razones técnicas sólo se pueda contratar con un proveedor.',
    iii_a: 'III. Cuando se declare desierta la convocatoria para la adquisición del bien y/o servicio por dos (2) veces consecutivas, por falta de proponentes.',
    iv: 'IV. Cuando el suministro de los bienes y servicios, por su especialidad, sólo puede ser ejecutado y/o suministrado por una determinada persona natural o jurídica (Intuito Personae).',
    v: 'V. Cuando se deba asegurar disponibilidad de manera continua en servicios de alojamiento o transporte.',
    vi: 'VI. En los servicios bajo la modalidad de suscripción, afiliación o inscripción a publicaciones físicas o digitales que sean de interés de La Corporación.',
    vii: 'VII. Contratos de arrendamiento de bienes inmuebles.',
    viii: 'VIII. Contratación de productos financieros y seguros.',
    ix: 'IX. Contratación de bienes y servicios relacionados con capacitaciones y Sistema de Gestión de Seguridad y Salud en el Trabajo (SG-SST).',
    x: 'X. Cuando sea requerido por urgencia manifiesta de contar con el bien y/o servicio de manera inmediata.',
};

function causalComiteTexto(solicitud) {
    const modalidad = String(solicitud?.modalidad || '').trim().toLowerCase();
    if (modalidad === 'invitacion') return 'Por invitación';
    if (modalidad === 'tdr') return 'Por términos de referencia';
    const codigo = String(solicitud?.modalidad_seleccion || '').toLowerCase().trim();
    if (codigo && CAUSALES_DIRECTA_LARGO[codigo]) return CAUSALES_DIRECTA_LARGO[codigo];
    if (codigo) return codigo;
    const justificacion = String(solicitud?.justificacion_cd || '').trim();
    if (justificacion) return justificacion;
    const criterios = String(solicitud?.criterios_contratacion || '').trim();
    if (criterios) return criterios;
    if (modalidad && modalidad !== 'directa') return `Contratación ${solicitud?.modalidad}`;
    return '';
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

export default {
    generarPdfFormatoPlaneacion,
    generarPdfActaComite,
    generarPdfEvaluacionProveedor,
};
