// ============================================================
// SERVICIO MICROSOFT GRAPH (APP-ONLY)
// ------------------------------------------------------------
// Sube archivos a SharePoint usando credenciales de una App
// Registration de Azure AD (client credentials flow), es decir,
// SIN depender de que el usuario tenga el navegador abierto.
//
// Se usa para guardar automáticamente el PDF firmado de la
// Evaluación de Proveedores en 03.Postcontractual apenas Adobe
// Sign confirma la firma del supervisor (ver routes/firmas.js).
//
// Modos:
//  - mock       → simula la subida sin llamar a Graph (útil para QA/dev)
//  - produccion → cuenta corporativa (requiere tenant/client/secret)
//
// La configuración se lee desde configuracion_graph_app en BD.
// ============================================================

import { ConfidentialClientApplication } from '@azure/msal-node';
import axios from 'axios';
import fs from 'fs';

const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

/** Codifica cada segmento de una ruta sin tocar las barras. */
function encodeRutaGraph(ruta) {
    return ruta.split('/').filter(Boolean).map(encodeURIComponent).join('/');
}

/**
 * Lee la configuración desde BD.
 * @param {pg.Pool} pool
 */
async function obtenerConfig(pool) {
    const { rows } = await pool.query(`SELECT * FROM configuracion_graph_app WHERE id = 1`);
    if (rows.length === 0) {
        throw new Error('configuracion_graph_app vacía. Ejecuta migración 50.');
    }
    return rows[0];
}

/**
 * Obtiene un access token de aplicación válido. Refresca si está vencido.
 * @param {pg.Pool} pool
 * @param {object} config
 */
async function obtenerAccessToken(pool, config) {
    if (!config.tenant_id || !config.client_id || !config.client_secret) {
        throw new Error('Microsoft Graph sin credenciales. Configura la App Registration desde el panel de administrador.');
    }

    // Si el token vigente aún sirve (margen 5min), reutilizar
    if (
        config.access_token &&
        config.access_expira_en &&
        new Date(config.access_expira_en).getTime() > Date.now() + 5 * 60 * 1000
    ) {
        return config.access_token;
    }

    const cca = new ConfidentialClientApplication({
        auth: {
            clientId: config.client_id,
            authority: `https://login.microsoftonline.com/${config.tenant_id}`,
            clientSecret: config.client_secret,
        },
    });

    const result = await cca.acquireTokenByClientCredential({
        scopes: ['https://graph.microsoft.com/.default'],
    });

    if (!result?.accessToken) {
        throw new Error('No se pudo obtener un token de Microsoft Graph con las credenciales configuradas.');
    }

    const expira = result.expiresOn ? new Date(result.expiresOn) : new Date(Date.now() + 3500 * 1000);

    await pool.query(
        `UPDATE configuracion_graph_app
            SET access_token = $1, access_expira_en = $2, actualizado_en = NOW()
          WHERE id = 1`,
        [result.accessToken, expira]
    );

    return result.accessToken;
}

/** Resuelve el sitio "Documental" y la biblioteca "Expedientes" (o las configuradas). */
async function resolverSitioYDrive(token, config) {
    const headers = { Authorization: `Bearer ${token}` };
    const siteSearch = config.site_search || 'Documental';
    const driveName = config.drive_name || 'Expedientes';

    const sitesRes = await axios.get(`${GRAPH_BASE}/sites?search=${encodeURIComponent(siteSearch)}`, { headers });
    const site = sitesRes.data?.value?.[0];
    if (!site) throw new Error(`No se encontró el sitio "${siteSearch}" en SharePoint.`);

    const drivesRes = await axios.get(`${GRAPH_BASE}/sites/${site.id}/drives`, { headers });
    const drives = drivesRes.data?.value || [];
    const drive = drives.find((d) => d.name === driveName) ?? drives[0];
    if (!drive) throw new Error(`No se encontró la biblioteca "${driveName}" en el sitio "${siteSearch}".`);

    return { site, drive };
}

/** Crea la carpeta `nombre` dentro de `parentPath` si no existe todavía. */
async function asegurarCarpeta(token, driveId, parentPath, nombre) {
    const headers = { Authorization: `Bearer ${token}` };
    const rutaPadre = encodeRutaGraph(parentPath);
    try {
        await axios.get(`${GRAPH_BASE}/drives/${driveId}/root:/${rutaPadre}/${encodeURIComponent(nombre)}`, { headers });
    } catch {
        await axios.post(
            `${GRAPH_BASE}/drives/${driveId}/root:/${rutaPadre}:/children`,
            { name: nombre, folder: {}, '@microsoft.graph.conflictBehavior': 'rename' },
            { headers: { ...headers, 'Content-Type': 'application/json' } }
        );
    }
}

/**
 * Sube un PDF a la carpeta del contrato en SharePoint (crea las carpetas
 * que falten) usando credenciales de aplicación. No depende de que el
 * usuario tenga sesión activa en el navegador.
 *
 * @param {object} params
 * @param {pg.Pool} params.pool
 * @param {string} params.codigoContrato - Código de la solicitud (nombre de carpeta raíz)
 * @param {string} params.subcarpeta - p.ej. '03.Postcontractual'
 * @param {string} params.nombreArchivo
 * @param {string} params.filePath - Ruta absoluta local del PDF a subir
 * @returns {Promise<{ok: boolean, modo: string, webUrl: string|null}>}
 */
export async function subirArchivoContrato({ pool, codigoContrato, subcarpeta, nombreArchivo, filePath }) {
    const config = await obtenerConfig(pool);

    if (config.modo === 'mock') {
        return {
            ok: true,
            modo: 'mock',
            webUrl: `mock://sharepoint/${config.parent_path || 'Pruebas tecnicas'}/${codigoContrato}/${subcarpeta}/${nombreArchivo}`,
        };
    }

    const token = await obtenerAccessToken(pool, config);
    const { drive } = await resolverSitioYDrive(token, config);
    const parentPath = config.parent_path || 'Pruebas tecnicas';

    await asegurarCarpeta(token, drive.id, parentPath, codigoContrato);
    await asegurarCarpeta(token, drive.id, `${parentPath}/${codigoContrato}`, subcarpeta);

    const buffer = fs.readFileSync(filePath);
    const rutaDestino = encodeRutaGraph(`${parentPath}/${codigoContrato}/${subcarpeta}/${nombreArchivo}`);

    const resp = await axios.put(
        `${GRAPH_BASE}/drives/${drive.id}/root:/${rutaDestino}:/content`,
        buffer,
        {
            headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/pdf' },
            maxBodyLength: Infinity,
            maxContentLength: Infinity,
        }
    );

    return { ok: true, modo: config.modo, webUrl: resp.data?.webUrl || null };
}

/** Estado de configuración (para el panel de administrador). */
export async function obtenerEstadoConexion(pool) {
    const config = await obtenerConfig(pool);
    const configured = !!(config.tenant_id && config.client_id && config.client_secret);
    return {
        modo: config.modo,
        configured,
        site_search: config.site_search,
        drive_name: config.drive_name,
        parent_path: config.parent_path,
    };
}

export default {
    subirArchivoContrato,
    obtenerEstadoConexion,
};
