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
};
