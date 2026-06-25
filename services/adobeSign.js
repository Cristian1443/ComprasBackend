// ============================================================
// SERVICIO ADOBE ACROBAT SIGN
// ------------------------------------------------------------
// Maneja:
//  - Autenticación OAuth (refresh automático)
//  - Subida de PDFs como transient documents
//  - Creación de acuerdos (agreements) con firmantes en orden
//  - Consulta de estado (polling)
//  - Descarga de PDF firmado
//
// Modos:
//  - mock        → simula firmas sin llamar a Adobe (útil para QA/dev)
//  - sandbox     → cuenta de desarrollo Adobe Sign
//  - produccion  → cuenta corporativa
//
// La configuración se lee desde configuracion_adobe_sign en BD.
// ============================================================

import axios from 'axios';
import FormData from 'form-data';
import fs from 'fs';
import crypto from 'crypto';

/**
 * Lee la configuración desde BD.
 * @param {pg.Pool} pool
 */
async function obtenerConfig(pool) {
    const { rows } = await pool.query(
        `SELECT * FROM configuracion_adobe_sign WHERE id = 1`
    );
    if (rows.length === 0) {
        throw new Error('configuracion_adobe_sign vacía. Ejecuta migración 29.');
    }
    return rows[0];
}

/**
 * Obtiene un access token válido. Refresca si está vencido.
 * @param {pg.Pool} pool
 * @param {object} config
 */
async function obtenerAccessToken(pool, config) {
    // Integration Key tiene preferencia (más simple, no requiere refresh)
    if (config.integration_key) {
        return { token: config.integration_key, baseUrl: config.api_base_url };
    }

    if (!config.client_id || !config.client_secret || !config.refresh_token) {
        throw new Error('Adobe Sign sin credenciales. Configura desde el panel de administrador.');
    }

    // Si el token vigente aún sirve (margen 5min), reutilizar
    if (
        config.access_token &&
        config.access_expira_en &&
        new Date(config.access_expira_en).getTime() > Date.now() + 5 * 60 * 1000
    ) {
        return { token: config.access_token, baseUrl: config.api_base_url };
    }

    // Refresh — intenta múltiples shards en orden; Adobe devuelve api_access_point correcto
    const params = new URLSearchParams();
    params.append('grant_type', 'refresh_token');
    params.append('client_id', config.client_id);
    params.append('client_secret', config.client_secret);
    params.append('refresh_token', config.refresh_token);
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };

    const refreshEndpoints = [...new Set([
        `${(config.api_base_url || 'https://api.na4.adobesign.com').replace(/\/$/, '')}/oauth/v2/refresh`,
        'https://api.na4.adobesign.com/oauth/v2/refresh',
        'https://api.na1.adobesign.com/oauth/v2/refresh',
        'https://secure.echosign.com/oauth/v2/refresh',
    ])];

    let respData = null;
    let lastErr = null;
    for (const url of refreshEndpoints) {
        try {
            const r = await axios.post(url, params, { headers });
            respData = r.data;
            break;
        } catch (e) {
            lastErr = e;
            console.warn('[adobeSign] refresh falló en', url, e.response?.data || e.message);
        }
    }
    if (!respData) throw lastErr || new Error('No se pudo refrescar el token de Adobe Sign');

    const access = respData.access_token;
    const ttl = respData.expires_in || 3600;
    const expira = new Date(Date.now() + ttl * 1000);
    const apiPoint = respData.api_access_point ? respData.api_access_point.replace(/\/$/, '') : null;

    await pool.query(
        `UPDATE configuracion_adobe_sign
            SET access_token = $1, access_expira_en = $2,
                api_base_url = COALESCE($3, api_base_url),
                actualizado_en = NOW()
            WHERE id = 1`,
        [access, expira, apiPoint]
    );

    return { token: access, baseUrl: apiPoint || config.api_base_url };
}

/**
 * Sube un PDF como transient document.
 * Devuelve el transientDocumentId que se usará al crear el agreement.
 */
async function subirTransientDocument(pool, pdfPath, nombreArchivo) {
    const config = await obtenerConfig(pool);

    if (config.modo === 'mock') {
        return 'mock-transient-' + crypto.randomUUID();
    }

    const { token, baseUrl } = await obtenerAccessToken(pool, config);

    const form = new FormData();
    form.append('File', fs.createReadStream(pdfPath), {
        filename: nombreArchivo,
        contentType: 'application/pdf',
    });
    form.append('Mime-Type', 'application/pdf');
    form.append('File-Name', nombreArchivo);

    const resp = await axios.post(
        `${baseUrl}/api/rest/v6/transientDocuments`,
        form,
        {
            headers: {
                ...form.getHeaders(),
                Authorization: `Bearer ${token}`,
            },
            maxBodyLength: Infinity,
        }
    );

    return resp.data.transientDocumentId;
}

/**
 * Crea un acuerdo en Adobe Sign con uno o más firmantes en orden.
 *
 * @param {object} params
 * @param {pg.Pool} params.pool
 * @param {string} params.pdfPath - Ruta absoluta al PDF
 * @param {string} params.nombreArchivo
 * @param {string} params.titulo - Nombre del acuerdo
 * @param {Array<{nombre, email, orden}>} params.firmantes
 * @param {string} [params.mensaje]
 * @returns {Promise<{agreementId: string, url?: string}>}
 */
export async function crearAcuerdo({ pool, pdfPath, nombreArchivo, titulo, firmantes, mensaje }) {
    const config = await obtenerConfig(pool);

    if (config.modo === 'mock') {
        const agreementId = 'mock-' + crypto.randomUUID();
        return {
            agreementId,
            url: `mock://acuerdos/${agreementId}`,
            modo: 'mock',
        };
    }

    const { token, baseUrl } = await obtenerAccessToken(pool, config);

    const transientDocumentId = await subirTransientDocument(pool, pdfPath, nombreArchivo);

    const ordenados = [...firmantes].sort((a, b) => (a.orden || 1) - (b.orden || 1));

    const participantSetsInfo = ordenados.map((f, idx) => ({
        memberInfos: [{ email: f.email, name: f.nombre || f.email }],
        order: idx + 1,
        role: 'SIGNER',
        name: `signer_${idx + 1}`,
    }));

    // Crear acuerdo directamente en IN_PROCESS — Adobe Sign envía el correo de inmediato
    const resp = await axios.post(
        `${baseUrl}/api/rest/v6/agreements`,
        {
            fileInfos: [{ transientDocumentId }],
            name: titulo,
            participantSetsInfo,
            signatureType: 'ESIGN',
            state: 'IN_PROCESS',
            message: mensaje || 'Solicitamos su firma para continuar con el proceso.',
        },
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json',
            },
        }
    );

    const agreementId = resp.data.id;

    const enlacesFirma = await obtenerEnlacesFirma(pool, agreementId).catch(() => []);

    return {
        agreementId,
        modo: config.modo,
        enlacesFirma,
    };
}

/** Obtiene URLs de firma por firmante (útil si el correo no llega). */
export async function obtenerEnlacesFirma(pool, agreementId) {
    const config = await obtenerConfig(pool);
    if (config.modo === 'mock' || String(agreementId).startsWith('mock-')) return [];

    const { token, baseUrl } = await obtenerAccessToken(pool, config);
    const resp = await axios.post(
        `${baseUrl}/api/rest/v6/agreements/${agreementId}/signingUrls`,
        {},
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );

    const enlaces = [];
    for (const set of resp.data.signingUrlSetInfos || []) {
        for (const u of set.signingUrls || []) {
            enlaces.push({ email: u.email, url: u.esignUrl || u.url });
        }
    }
    return enlaces;
}

/**
 * Consulta el estado de un acuerdo y la información de los firmantes.
 */
export async function obtenerEstadoAcuerdo(pool, agreementId) {
    const config = await obtenerConfig(pool);

    if (config.modo === 'mock' || String(agreementId).startsWith('mock-')) {
        // Simulamos un avance: después de 30s queda firmado
        const ageMs = Date.now() - parseInt(agreementId.slice(-13), 36) || 0;
        const firmado = ageMs > 30000;
        return {
            estadoAdobe: firmado ? 'SIGNED' : 'OUT_FOR_SIGNATURE',
            estadoInterno: firmado ? 'firmado' : 'firmando',
            firmantes: [],
            firmado,
        };
    }

    const { token, baseUrl } = await obtenerAccessToken(pool, config);

    const [acuerdoResp, membersResp] = await Promise.all([
        axios.get(`${baseUrl}/api/rest/v6/agreements/${agreementId}`, {
            headers: { Authorization: `Bearer ${token}` },
        }),
        axios.get(`${baseUrl}/api/rest/v6/agreements/${agreementId}/members`, {
            headers: { Authorization: `Bearer ${token}` },
        }),
    ]);

    const estadoAdobe = acuerdoResp.data.status;
    const estadoInterno = mapearEstado(estadoAdobe);

    const firmantes = [];
    for (const set of membersResp.data.participantSets || []) {
        for (const m of set.memberInfos || []) {
            firmantes.push({
                email: m.email,
                nombre: m.name,
                estado: m.status,
                firmadoEn: m.completedDate || null,
                orden: set.order,
            });
        }
    }

    return {
        estadoAdobe,
        estadoInterno,
        firmantes,
        firmado: ['SIGNED', 'COMPLETED', 'APPROVED', 'ACCEPTED', 'FORM_FILLED'].includes(estadoAdobe),
    };
}

/**
 * Descarga el PDF firmado (combined document) y lo guarda en disco.
 * Devuelve la ruta absoluta del archivo.
 */
export async function descargarPdfFirmado(pool, agreementId, destinoPath) {
    const config = await obtenerConfig(pool);

    if (config.modo === 'mock' || String(agreementId).startsWith('mock-')) {
        // Para modo mock copiamos un PDF dummy de 1 página
        fs.writeFileSync(
            destinoPath,
            Buffer.from(
                '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 612 792]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF',
                'utf8'
            )
        );
        return destinoPath;
    }

    const { token, baseUrl } = await obtenerAccessToken(pool, config);

    const resp = await axios.get(
        `${baseUrl}/api/rest/v6/agreements/${agreementId}/combinedDocument`,
        {
            headers: { Authorization: `Bearer ${token}` },
            responseType: 'arraybuffer',
        }
    );

    fs.writeFileSync(destinoPath, Buffer.from(resp.data));
    return destinoPath;
}

/**
 * Cancela un acuerdo en curso (al rechazar, por ejemplo).
 */
export async function cancelarAcuerdo(pool, agreementId, motivo) {
    const config = await obtenerConfig(pool);
    if (config.modo === 'mock' || String(agreementId).startsWith('mock-')) {
        return { ok: true, modo: 'mock' };
    }
    const { token, baseUrl } = await obtenerAccessToken(pool, config);
    await axios.put(
        `${baseUrl}/api/rest/v6/agreements/${agreementId}/state`,
        { state: 'CANCELLED', agreementCancellationInfo: { comment: motivo || 'Cancelado desde el sistema', notifyOthers: true } },
        { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } }
    );
    return { ok: true };
}

/**
 * Mapea el estado de Adobe Sign al estado interno del sistema.
 */
function mapearEstado(estadoAdobe) {
    switch (String(estadoAdobe || '').toUpperCase()) {
        case 'OUT_FOR_SIGNATURE': return 'firmando';
        case 'SIGNED':
        case 'APPROVED':
        case 'ACCEPTED':
        case 'FORM_FILLED':
        case 'COMPLETED':
            return 'firmado';
        case 'DECLINED':
        case 'CANCELLED':
        case 'REJECTED':
            return 'rechazado';
        case 'EXPIRED':
            return 'expirado';
        case 'DRAFT':
        case 'AUTHORING':
            return 'pendiente';
        default:
            return 'firmando';
    }
}

export default {
    crearAcuerdo,
    obtenerEstadoAcuerdo,
    descargarPdfFirmado,
    cancelarAcuerdo,
};
