// ============================================================
// RUTAS DE FIRMA ELECTRÓNICA (Adobe Acrobat Sign)
// ------------------------------------------------------------
// POST   /api/solicitudes/:id/firmas/:etapa/iniciar
// GET    /api/solicitudes/:id/firmas
// GET    /api/firmas/:firmaId/pdf-firmado
// GET    /api/firmas/:firmaId/estado
// POST   /api/firmas/:firmaId/cancelar
//
// ADMIN:
// GET/PUT /api/configuracion/firmantes
// GET/PUT /api/configuracion/adobe-sign
//
// Bloqueo del flujo:
//   La aprobación NO avanza el estado de la solicitud hasta que
//   la firma de la etapa esté en estado 'firmado'. El endpoint
//   PATCH /api/solicitudes/:id/estado verifica esto antes de
//   permitir el avance.
// ============================================================

import express from 'express';
import path from 'path';
import fs from 'fs';
import cron from 'node-cron';
import axios from 'axios';
import crypto from 'crypto';

import {
    crearAcuerdo,
    obtenerEstadoAcuerdo,
    descargarPdfFirmado,
    cancelarAcuerdo,
} from '../services/adobeSign.js';
import {
    generarPdfFormatoPlaneacion,
    generarPdfActaComite,
    generarPdfActaComiteMultiple,
} from '../services/pdfGenerator.js';

const ETAPAS_VALIDAS = ['gerente', 'financiera', 'comite', 'juridica', 'proveedor'];
/** Etapas que ya no usan Adobe Sign; la aprobación queda con estampa de tiempo. */
const ETAPAS_SIN_FIRMA_ELECTRONICA = ['gerente', 'financiera', 'juridica'];
const OAUTH_SCOPES = 'user_login:self+agreement_send:account+agreement_read:account+agreement_write:account';

function oauthRedirectUri(req) {
    const base = process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`;
    return `${base.replace(/\/$/, '')}/api/adobe-sign/oauth/callback`;
}

function oauthAuthorizeBase(apiBaseUrl) {
    if (process.env.ADOBE_OAUTH_BASE_URL) return process.env.ADOBE_OAUTH_BASE_URL.replace(/\/$/, '');
    // Apps SOCIO (partner) requieren secure.echosign.com, no el shard de la cuenta
    if (process.env.ADOBE_APP_SOCIO === '1') return 'https://secure.echosign.com';
    if (!apiBaseUrl) return 'https://secure.na4.adobesign.com';
    if (apiBaseUrl.includes('na4')) return 'https://na4.documents.adobe.com';
    return apiBaseUrl.replace('://api.', '://secure.').replace(/\/$/, '');
}

async function leerConfigAdobe(pool) {
    const r = await pool.query(`SELECT * FROM configuracion_adobe_sign WHERE id = 1`);
    return r.rows[0] || null;
}

function tokenEndpointsOAuth(apiBaseUrl) {
    const shard = (apiBaseUrl || 'https://api.na4.adobesign.com').replace(/\/$/, '');
    const endpoints = [
        'https://secure.echosign.com/oauth/v2/token',
        `${shard}/oauth/v2/token`,
        'https://secure.na4.adobesign.com/oauth/v2/token',
    ];
    return [...new Set(endpoints)];
}

async function intercambiarCodigoOAuth(cfg, redirectUri, code) {
    const body = new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: cfg.client_id,
        client_secret: cfg.client_secret,
        redirect_uri: redirectUri,
        code: String(code),
    });
    const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
    let ultimoError = null;

    for (const tokenUrl of tokenEndpointsOAuth(cfg.api_base_url)) {
        try {
            const tokenRes = await axios.post(tokenUrl, body.toString(), { headers });
            return { data: tokenRes.data, tokenUrl };
        } catch (err) {
            ultimoError = err;
            console.warn('[firmas] OAuth token falló en', tokenUrl, err.response?.data || err.message);
        }
    }
    throw ultimoError || new Error('No se pudo intercambiar el código OAuth');
}

/**
 * Inicializa el módulo: registra rutas en la app y arranca el cron.
 *
 * @param {express.Express} app
 * @param {pg.Pool} pool
 * @param {string} uploadsDir - Directorio absoluto donde guardar PDFs
 */
export function registrarRutasFirmas(app, pool, uploadsDir) {
    const FIRMAS_DIR = path.join(uploadsDir, 'firmas');
    fs.mkdirSync(FIRMAS_DIR, { recursive: true });

    const router = express.Router();

    // ============================================================
    // Helpers
    // ============================================================

    /** Obtiene el detalle completo de la solicitud para generar el PDF. */
    async function obtenerSolicitudCompleta(solicitudId) {
        const r = await pool.query(`SELECT * FROM v_solicitudes_resumen WHERE id = $1`, [solicitudId]);
        if (r.rows.length === 0) return null;
        const sol = r.rows[0];
        const f = await pool.query(`SELECT * FROM solicitudes WHERE id = $1`, [solicitudId]);
        if (f.rows.length > 0) Object.assign(sol, f.rows[0]);
        try {
            const m = await pool.query(`SELECT * FROM solicitudes_modalidad_directa WHERE solicitud_id = $1`, [solicitudId]);
            if (m.rows[0]) Object.assign(sol, m.rows[0]);
        } catch { /* ignorar si tabla no existe */ }
        return sol;
    }

    /** Resuelve los firmantes para una etapa según las reglas de negocio. */
    async function resolverFirmantes(etapa, solicitud) {
        const out = [];
        if (etapa === 'gerente') {
            // Firma el gerente del área asignado a la solicitud
            if (solicitud.gerente_email) {
                out.push({
                    rol_firma: 'gerente',
                    nombre: solicitud.gerente_nombre || solicitud.gerente_email,
                    email: solicitud.gerente_email,
                    cargo: 'Gerente de Área',
                    orden: 1,
                });
            } else {
                // Buscar email del gerente desde usuarios
                if (solicitud.gerente_id) {
                    const r = await pool.query(`SELECT nombre, email, cargo FROM usuarios WHERE id = $1`, [solicitud.gerente_id]);
                    if (r.rows[0]) {
                        out.push({
                            rol_firma: 'gerente',
                            nombre: r.rows[0].nombre,
                            email: r.rows[0].email,
                            cargo: r.rows[0].cargo || 'Gerente de Área',
                            orden: 1,
                        });
                    }
                }
            }
        } else if (etapa === 'financiera') {
            const r = await pool.query(
                `SELECT * FROM configuracion_firmantes WHERE rol_firma = 'director_financiero' AND activo = TRUE`
            );
            if (r.rows[0]) {
                out.push({
                    rol_firma: 'director_financiero',
                    nombre: r.rows[0].nombre,
                    email: r.rows[0].email,
                    cargo: r.rows[0].cargo || 'Jefe de Financiera',
                    orden: 1,
                });
            }
        } else if (etapa === 'comite') {
            const r = await pool.query(
                `SELECT * FROM configuracion_firmantes
                  WHERE rol_firma IN ('directora_comite', 'secretaria_comite') AND activo = TRUE
                  ORDER BY CASE rol_firma WHEN 'directora_comite' THEN 1 ELSE 2 END`
            );
            r.rows.forEach((row, idx) => {
                out.push({
                    rol_firma: row.rol_firma,
                    nombre: row.nombre,
                    email: row.email,
                    cargo: row.cargo,
                    orden: idx + 1,
                });
            });
        } else if (etapa === 'juridica') {
            // Cualquier persona de jurídica; usa la que aprobó (juridica_id) o se pasa por body
            if (solicitud.juridica_id) {
                const r = await pool.query(`SELECT nombre, email, cargo FROM usuarios WHERE id = $1`, [solicitud.juridica_id]);
                if (r.rows[0]) {
                    out.push({
                        rol_firma: 'juridica',
                        nombre: r.rows[0].nombre,
                        email: r.rows[0].email,
                        cargo: r.rows[0].cargo || 'Jurídica',
                        orden: 1,
                    });
                }
            }
        }
        return out;
    }

    /** Mapea etapa → tipo de documento */
    function tipoDocumentoDe(etapa) {
        return {
            gerente: 'formato_planeacion',
            financiera: 'formato_planeacion',
            juridica: 'visto_bueno_juridica',
            comite: 'acta_comite',
            proveedor: 'contrato',
        }[etapa] || 'formato_planeacion';
    }

    // ============================================================
    // POST /api/solicitudes/:id/firmas/:etapa/iniciar
    // ============================================================
    router.post('/solicitudes/:id/firmas/:etapa/iniciar', async (req, res) => {
        const { id, etapa } = req.params;
        const {
            actaNumero, fechaSesion, participantes, discusion, decision,
            solicitudesMultiples,
            firmanteJuridica, iniciadoPor,
        } = req.body || {};

        if (!ETAPAS_VALIDAS.includes(etapa)) {
            return res.status(400).json({ error: 'Etapa inválida.' });
        }

        if (ETAPAS_SIN_FIRMA_ELECTRONICA.includes(etapa)) {
            return res.status(410).json({
                error: 'firma_desactivada',
                mensaje: 'La firma electrónica no aplica en esta etapa. La aprobación queda registrada con estampa de tiempo.',
            });
        }

        try {
            const solicitud = await obtenerSolicitudCompleta(id);
            if (!solicitud) return res.status(404).json({ error: 'Solicitud no encontrada.' });

            // ¿Ya hay una firma en curso/firmada para esta etapa?
            const existente = await pool.query(
                `SELECT id, estado, agreement_id FROM firmas_documento
                  WHERE solicitud_id = $1 AND etapa = $2
                  ORDER BY creado_en DESC LIMIT 1`,
                [id, etapa]
            );
            if (existente.rows.length > 0) {
                const e = existente.rows[0];
                if (e.estado === 'firmado') {
                    return res.status(409).json({ error: 'Esta etapa ya fue firmada.', firma_id: e.id });
                }
                if (['enviado', 'firmando'].includes(e.estado)) {
                    return res.status(409).json({
                        error: 'Ya hay un acuerdo en curso para esta etapa.',
                        firma_id: e.id,
                    });
                }
            }

            // Resolver firmantes
            let firmantes = await resolverFirmantes(etapa, solicitud);

            // Para jurídica permite pasar el firmante en el body
            if (etapa === 'juridica' && firmantes.length === 0 && firmanteJuridica?.email) {
                firmantes.push({
                    rol_firma: 'juridica',
                    nombre: firmanteJuridica.nombre || firmanteJuridica.email,
                    email: firmanteJuridica.email,
                    cargo: firmanteJuridica.cargo || 'Jurídica',
                    orden: 1,
                });
            }

            if (firmantes.length === 0) {
                return res.status(400).json({
                    error: `No se encontraron firmantes para la etapa "${etapa}". Verifica la configuración.`,
                });
            }

            // Generar PDF
            const carpetaSolicitud = path.join(FIRMAS_DIR, id);
            fs.mkdirSync(carpetaSolicitud, { recursive: true });
            const nombreArchivo = `${etapa}_${Date.now()}.pdf`;
            const pdfPath = path.join(carpetaSolicitud, nombreArchivo);

            if (etapa === 'comite') {
                const numActa = actaNumero || `Sesión ${formatearFechaCorta(new Date())}`;
                const fechaActa = fechaSesion || new Date().toISOString();
                const participantesActa = participantes || [];

                if (Array.isArray(solicitudesMultiples) && solicitudesMultiples.length > 1) {
                    const items = [];
                    for (const item of solicitudesMultiples) {
                        const sol = await obtenerSolicitudCompleta(item.id);
                        if (sol) items.push({ solicitud: sol, discusion: item.discusion || '', decision: item.decision || 'aprobada' });
                    }
                    await generarPdfActaComiteMultiple({
                        solicitudes: items,
                        actaNumero: numActa,
                        fechaSesion: fechaActa,
                        participantes: participantesActa,
                        destinoPath: pdfPath,
                    });
                } else {
                    await generarPdfActaComite({
                        solicitud,
                        actaNumero: numActa,
                        fechaSesion: fechaActa,
                        participantes: participantesActa,
                        discusion: discusion || '',
                        decision: decision || 'aprobada',
                        destinoPath: pdfPath,
                    });
                }
            } else {
                await generarPdfFormatoPlaneacion(solicitud, etapa, pdfPath);
            }

            const titulo = etapa === 'comite'
                ? `Acta Comité - ${solicitud.codigo}`
                : `Aprobación ${etapa} - ${solicitud.codigo}`;

            // Crear acuerdo en Adobe
            const acuerdo = await crearAcuerdo({
                pool,
                pdfPath,
                nombreArchivo,
                titulo,
                firmantes,
                mensaje: `Por favor, firma el documento ${titulo}.`,
            });

            // Registrar en BD (firmas + firmantes)
            const insertFirma = await pool.query(
                `INSERT INTO firmas_documento
                    (solicitud_id, etapa, tipo_documento, titulo, agreement_id, estado,
                     pdf_original_path, iniciado_por, enviado_en, metadata)
                 VALUES ($1, $2, $3, $4, $5, 'enviado', $6, $7, NOW(), $8::jsonb)
                 RETURNING *`,
                [
                    id, etapa, tipoDocumentoDe(etapa), titulo,
                    acuerdo.agreementId, pdfPath, iniciadoPor || null,
                    JSON.stringify({ modo: acuerdo.modo || 'real', enlaces_firma: acuerdo.enlacesFirma || [] }),
                ]
            );
            const firma = insertFirma.rows[0];

            for (const f of firmantes) {
                await pool.query(
                    `INSERT INTO firmantes_documento (firma_id, orden, rol_firma, nombre, email, cargo)
                     VALUES ($1, $2, $3, $4, $5, $6)`,
                    [firma.id, f.orden || 1, f.rol_firma, f.nombre, f.email, f.cargo || null]
                );
            }

            return res.json({
                ok: true,
                firma: { ...firma, firmantes },
                mensaje: acuerdo.modo === 'mock'
                    ? 'Modo mock: se simulará firma automática en ~30 segundos.'
                    : 'Acuerdo enviado a Adobe Sign. Los firmantes recibirán un correo.',
            });
        } catch (err) {
            console.error('[firmas] Error iniciando firma:', err);
            return res.status(500).json({ error: 'No se pudo iniciar la firma.', detalle: String(err.message || err) });
        }
    });

    // ============================================================
    // GET /api/solicitudes/:id/firmas
    // ============================================================
    router.get('/solicitudes/:id/firmas', async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT v.*, fd.metadata
                   FROM v_firmas_por_etapa v
                   JOIN firmas_documento fd ON fd.id = v.firma_id
                  WHERE v.solicitud_id = $1
                  ORDER BY v.firma_id`,
                [req.params.id]
            );
            res.json(r.rows);
        } catch (err) {
            console.error('[firmas] Error listando:', err);
            res.status(500).json({ error: 'Error listando firmas.' });
        }
    });

    // ============================================================
    // GET /api/firmas/:firmaId/estado
    // (consulta a Adobe y actualiza BD)
    // ============================================================
    router.get('/firmas/:firmaId/estado', async (req, res) => {
        try {
            const firmaRow = await pool.query(
                `SELECT * FROM firmas_documento WHERE id = $1`,
                [req.params.firmaId]
            );
            if (firmaRow.rows.length === 0) return res.status(404).json({ error: 'Firma no encontrada.' });
            const firma = firmaRow.rows[0];

            if (!firma.agreement_id) {
                return res.json({ estado: firma.estado, ...firma });
            }

            const estado = await sincronizarFirma(pool, firma, FIRMAS_DIR);
            res.json(estado);
        } catch (err) {
            console.error('[firmas] Error consultando estado:', err);
            res.status(500).json({ error: 'Error consultando estado.' });
        }
    });

    // ============================================================
    // GET /api/firmas/:firmaId/pdf-firmado
    // ============================================================
    router.get('/firmas/:firmaId/pdf-firmado', async (req, res) => {
        try {
            const r = await pool.query(`SELECT * FROM firmas_documento WHERE id = $1`, [req.params.firmaId]);
            if (r.rows.length === 0) return res.status(404).send('No encontrado');
            const firma = r.rows[0];
            const archivo = firma.pdf_firmado_path || firma.pdf_original_path;
            if (!archivo || !fs.existsSync(archivo)) {
                return res.status(404).send('PDF no disponible aún');
            }
            res.download(archivo, path.basename(archivo));
        } catch (err) {
            console.error('[firmas] Error descargando PDF:', err);
            res.status(500).send('Error descargando PDF');
        }
    });

    // ============================================================
    // POST /api/firmas/:firmaId/cancelar
    // ============================================================
    router.post('/firmas/:firmaId/cancelar', async (req, res) => {
        try {
            const r = await pool.query(`SELECT * FROM firmas_documento WHERE id = $1`, [req.params.firmaId]);
            if (r.rows.length === 0) return res.status(404).json({ error: 'No encontrada' });
            const firma = r.rows[0];
            if (firma.agreement_id) {
                await cancelarAcuerdo(pool, firma.agreement_id, req.body?.motivo);
            }
            await pool.query(
                `UPDATE firmas_documento SET estado = 'rechazado', actualizado_en = NOW(), error_mensaje = $2 WHERE id = $1`,
                [req.params.firmaId, req.body?.motivo || 'Cancelada por el usuario']
            );
            res.json({ ok: true });
        } catch (err) {
            console.error('[firmas] Error cancelando:', err);
            res.status(500).json({ error: 'Error cancelando' });
        }
    });

    // ============================================================
    // Configuración firmantes
    // ============================================================
    router.get('/configuracion/firmantes', async (_req, res) => {
        try {
            const r = await pool.query(`SELECT * FROM configuracion_firmantes ORDER BY rol_firma`);
            res.json(r.rows);
        } catch (err) {
            res.status(500).json({ error: 'Error' });
        }
    });

    router.put('/configuracion/firmantes/:rol', async (req, res) => {
        const { rol } = req.params;
        const { nombre, email, cargo, activo } = req.body || {};
        try {
            await pool.query(
                `INSERT INTO configuracion_firmantes (rol_firma, nombre, email, cargo, activo, actualizado_en)
                 VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), NOW())
                 ON CONFLICT (rol_firma) DO UPDATE
                    SET nombre = EXCLUDED.nombre,
                        email = EXCLUDED.email,
                        cargo = EXCLUDED.cargo,
                        activo = EXCLUDED.activo,
                        actualizado_en = NOW()`,
                [rol, nombre, email, cargo || null, activo]
            );
            res.json({ ok: true });
        } catch (err) {
            console.error('[firmas] Error guardando firmante:', err);
            res.status(500).json({ error: 'Error guardando firmante' });
        }
    });

    router.get('/configuracion/adobe-sign', async (_req, res) => {
        try {
            const r = await pool.query(`SELECT id, api_base_url, modo, actualizado_en,
                                        (client_id IS NOT NULL AND client_id <> '') AS tiene_client_id,
                                        (client_secret IS NOT NULL AND client_secret <> '') AS tiene_client_secret,
                                        (refresh_token IS NOT NULL AND refresh_token <> '') AS tiene_refresh_token,
                                        (integration_key IS NOT NULL) AS tiene_integration_key
                                        FROM configuracion_adobe_sign WHERE id = 1`);
            res.json(r.rows[0] || {});
        } catch (err) {
            res.status(500).json({ error: 'Error' });
        }
    });

    router.put('/configuracion/adobe-sign', async (req, res) => {
        const { client_id, client_secret, refresh_token, integration_key, api_base_url, modo } = req.body || {};
        try {
            await pool.query(
                `UPDATE configuracion_adobe_sign
                    SET client_id      = COALESCE($1, client_id),
                        client_secret  = COALESCE($2, client_secret),
                        refresh_token  = COALESCE($3, refresh_token),
                        integration_key= COALESCE($4, integration_key),
                        api_base_url   = COALESCE($5, api_base_url),
                        modo           = COALESCE($6, modo),
                        actualizado_en = NOW()
                  WHERE id = 1`,
                [client_id, client_secret, refresh_token, integration_key, api_base_url, modo]
            );
            res.json({ ok: true });
        } catch (err) {
            console.error('[firmas] Error guardando config adobe:', err);
            res.status(500).json({ error: 'Error guardando configuración' });
        }
    });

    // OAuth: redirect URI propio (evita invalid_request con apps SOCIO)
    router.get('/adobe-sign/oauth/redirect-uri', (req, res) => {
        const redirectUri = oauthRedirectUri(req);
        const publicBase = (process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/$/, '');
        res.json({
            redirect_uri: redirectUri,
            connect_url: `${publicBase}/api/adobe-sign/oauth/iniciar`,
            public_base: publicBase,
            requiere_https: true,
            nota: 'Adobe exige https:// en el Redirect URI. Usa ngrok o un dominio HTTPS de tu organización.',
        });
    });

    router.get('/adobe-sign/oauth/auth-url', async (req, res) => {
        try {
            const cfg = await leerConfigAdobe(pool);
            if (!cfg?.client_id) return res.status(400).json({ error: 'Falta Client ID en configuración' });
            const redirectUri = oauthRedirectUri(req);
            const base = oauthAuthorizeBase(cfg.api_base_url);
            const state = crypto.randomBytes(8).toString('hex');
            const url = `${base}/public/oauth/v2?redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&client_id=${encodeURIComponent(cfg.client_id)}&scope=${OAUTH_SCOPES}&state=${state}`;
            res.json({
                auth_url: url,
                redirect_uri: redirectUri,
                oauth_base: base,
                client_id: cfg.client_id,
                api_base_url: cfg.api_base_url,
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    router.get('/adobe-sign/oauth/iniciar', async (req, res) => {
        try {
            const cfg = await leerConfigAdobe(pool);
            if (!cfg?.client_id) {
                return res.status(400).send('Guarda primero el Client ID en Admin → Parámetros → Configuración de firmas.');
            }

            const redirectUri = oauthRedirectUri(req);
            const state = crypto.randomBytes(16).toString('hex');
            const base = oauthAuthorizeBase(cfg.api_base_url);
            const url = `${base}/public/oauth/v2?redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&client_id=${encodeURIComponent(cfg.client_id)}&scope=${OAUTH_SCOPES}&state=${state}`;
            res.redirect(url);
        } catch (err) {
            console.error('[firmas] OAuth iniciar:', err);
            res.status(500).send('No se pudo iniciar la autorización OAuth.');
        }
    });

    router.get('/adobe-sign/oauth/callback', async (req, res) => {
        const { code, error, error_description: errorDesc, state } = req.query || {};
        if (error) {
            const msg = `Adobe Sign rechazó: ${error}${errorDesc ? ' — ' + errorDesc : ''}`;
            return res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
                <h2>Error al conectar Adobe Sign</h2><p>${msg}</p>
                <script>if(window.opener){window.opener.postMessage({adobeOk:false,error:${JSON.stringify(msg)}},'*');setTimeout(()=>window.close(),2000);}</script>
            </body></html>`);
        }
        if (!code) {
            return res.status(400).send('No llegó el código de autorización. Vuelve a intentar desde /api/adobe-sign/oauth/iniciar');
        }

        try {
            const cfg = await leerConfigAdobe(pool);
            if (!cfg?.client_id || !cfg?.client_secret) {
                return res.status(400).send('Faltan Client ID o Client Secret en la configuración.');
            }

            const redirectUri = oauthRedirectUri(req);
            const { data: tokenData } = await intercambiarCodigoOAuth(cfg, redirectUri, code);

            const refresh = tokenData.refresh_token;
            const access = tokenData.access_token;
            const ttl = tokenData.expires_in || 3600;
            const expira = new Date(Date.now() + ttl * 1000);
            const apiPoint = tokenData.api_access_point ? tokenData.api_access_point.replace(/\/$/, '') : null;

            await pool.query(
                `UPDATE configuracion_adobe_sign
                    SET refresh_token = $1,
                        access_token = $2,
                        access_expira_en = $3,
                        modo = 'produccion',
                        api_base_url = COALESCE($4, api_base_url),
                        actualizado_en = NOW()
                  WHERE id = 1`,
                [refresh, access, expira, apiPoint]
            );

            res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
                <h2>✅ Adobe Sign conectado correctamente</h2>
                <p>El <strong>refresh token</strong> ya quedó guardado en la base de datos.</p>
                <p>Puedes cerrar esta ventana.</p>
                <script>if(window.opener){window.opener.postMessage({adobeOk:true},'*');setTimeout(()=>window.close(),1000);}else{setTimeout(()=>window.close(),3000);}</script>
            </body></html>`);
        } catch (err) {
            const detalle = err.response?.data ? JSON.stringify(err.response.data) : err.message;
            console.error('[firmas] OAuth callback:', detalle);
            res.send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:2rem">
                <h2>Error al obtener tokens</h2><p>${detalle}</p>
                <script>if(window.opener){window.opener.postMessage({adobeOk:false,error:${JSON.stringify(String(detalle))}},'*');setTimeout(()=>window.close(),2000);}</script>
            </body></html>`);
        }
    });

    // Estado de conexión Adobe Sign (lee de BD)
    router.get('/adobe-sign/status', async (_req, res) => {
        try {
            const cfg = await leerConfigAdobe(pool);
            const configured = !!(cfg?.client_id || cfg?.integration_key);
            const connected = !!(cfg?.refresh_token || cfg?.integration_key);
            res.json({ connected, configured });
        } catch {
            res.json({ connected: false, configured: false });
        }
    });

    // Enviar Acta de Adjudicación a Adobe Sign para firma electrónica
    router.post('/juridica/solicitudes/:id/enviar-acta-adobe-sign', async (req, res) => {
        const { id } = req.params;
        const { pdfBase64, signers, asunto } = req.body || {};
        if (!pdfBase64 || !Array.isArray(signers) || signers.length === 0)
            return res.status(400).json({ error: 'Se requiere pdfBase64 y al menos un firmante.' });
        try {
            // Bloquear si ya hay una firma activa o completada
            const existente = await pool.query(
                `SELECT id, estado FROM actas_firmas WHERE solicitud_id = $1::uuid ORDER BY creado_en DESC LIMIT 1`,
                [id]
            );
            if (existente.rows.length > 0) {
                const e = existente.rows[0];
                if (e.estado === 'firmado') return res.status(409).json({ error: 'El acta ya fue firmada por todos los participantes.' });
                if (['enviado', 'firmando'].includes(e.estado)) return res.status(409).json({ error: 'Ya hay una solicitud de firma en curso. Espera a que todos firmen.' });
            }

            const carpeta = path.join(uploadsDir, 'actas');
            fs.mkdirSync(carpeta, { recursive: true });
            const nombreArchivo = `Acta_${id}_${Date.now()}.pdf`;
            const pdfPath = path.join(carpeta, nombreArchivo);
            fs.writeFileSync(pdfPath, Buffer.from(pdfBase64, 'base64'));
            const firmantes = signers.map((s, i) => ({
                nombre: s.name, email: s.email, cargo: s.role || '', orden: i + 1,
            }));
            const acuerdo = await crearAcuerdo({
                pool, pdfPath, nombreArchivo,
                titulo: asunto || `Acta de Adjudicación ${id}`,
                firmantes,
                mensaje: 'Por favor firme el Acta de Adjudicación adjunta.',
            });

            // Guardar registro de firma
            await pool.query(
                `INSERT INTO actas_firmas (solicitud_id, agreement_id, estado, pdf_path, firmantes)
                 VALUES ($1::uuid, $2, 'enviado', $3, $4::jsonb)`,
                [id, acuerdo.agreementId, pdfPath, JSON.stringify(signers)]
            );

            return res.json({
                ok: true,
                agreementId: acuerdo.agreementId,
                message: acuerdo.modo === 'mock'
                    ? `Modo mock: acta simulada para ${signers.length} firmante(s).`
                    : `Acta enviada a ${signers.length} firmante(s). Recibirán un correo de Adobe Sign para firmar.`,
                modo: acuerdo.modo,
            });
        } catch (err) {
            const detail = err.response?.data
                ? (typeof err.response.data === 'object' ? JSON.stringify(err.response.data) : String(err.response.data))
                : err.message;
            console.error('[firmas] Error enviando acta:', detail);
            return res.status(500).json({ error: detail || 'Error al enviar a Adobe Sign' });
        }
    });

    // Estado de la firma del acta de adjudicación (consulta Adobe Sign en tiempo real)
    router.get('/juridica/solicitudes/:id/acta-firma-estado', async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT * FROM actas_firmas WHERE solicitud_id = $1::uuid ORDER BY creado_en DESC LIMIT 1`,
                [req.params.id]
            );
            if (r.rows.length === 0) return res.json({ estado: 'sin_firma', firmaId: null });

            const firma = r.rows[0];
            if (firma.estado === 'firmado') {
                // Asegurar que acta_generada quede en true (puede que no se haya marcado al enviar)
                pool.query(
                    `SELECT evaluacion_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`,
                    [req.params.id]
                ).then(async detRes => {
                    const ev = detRes.rows[0]?.evaluacion_json || {};
                    if (!ev.acta_generada) {
                        const evaluacion = { ...ev, acta_generada: true, acta_generada_en: new Date().toISOString(), acta_generada_tipo: 'Adobe Sign (firmado)' };
                        await pool.query(
                            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, evaluacion_json, actualizado_en)
                             VALUES ($1::uuid, $2::jsonb, NOW())
                             ON CONFLICT (solicitud_id)
                             DO UPDATE SET evaluacion_json = EXCLUDED.evaluacion_json, actualizado_en = NOW()`,
                            [req.params.id, JSON.stringify(evaluacion)]
                        );
                    }
                }).catch(e => console.warn('[firmas] acta_generada backfill:', e.message));
                return res.json({ estado: 'firmado', firmaId: firma.id, pdfDisponible: !!(firma.pdf_firmado_path || firma.pdf_path), firmadoEn: firma.actualizado_en });
            }

            // En proceso: consultar Adobe Sign
            if (['enviado', 'firmando'].includes(firma.estado) && firma.agreement_id) {
                try {
                    const info = await obtenerEstadoAcuerdo(pool, firma.agreement_id);
                    const nuevoEstado = info.estadoInterno;
                    let pdfFirmadoPath = firma.pdf_firmado_path || null;
                    if (info.firmado && !pdfFirmadoPath) {
                        const carpeta = path.join(uploadsDir, 'actas');
                        fs.mkdirSync(carpeta, { recursive: true });
                        const dest = path.join(carpeta, `Acta_${req.params.id}_FIRMADO_${Date.now()}.pdf`);
                        await descargarPdfFirmado(pool, firma.agreement_id, dest);
                        pdfFirmadoPath = dest;
                    }
                    await pool.query(
                        `UPDATE actas_firmas SET estado = $1, pdf_firmado_path = COALESCE($2, pdf_firmado_path), actualizado_en = NOW() WHERE id = $3`,
                        [nuevoEstado, pdfFirmadoPath || null, firma.id]
                    );
                    // Cuando se completa la firma, marcar acta_generada en el flujo jurídico
                    if (info.firmado) {
                        try {
                            const detRes = await pool.query(
                                `SELECT evaluacion_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`,
                                [req.params.id]
                            );
                            const ev = detRes.rows[0]?.evaluacion_json || {};
                            if (!ev.acta_generada) {
                                const evaluacion = { ...ev, acta_generada: true, acta_generada_en: new Date().toISOString(), acta_generada_tipo: 'Adobe Sign (firmado)' };
                                await pool.query(
                                    `INSERT INTO solicitudes_detalle_juridico (solicitud_id, evaluacion_json, actualizado_en)
                                     VALUES ($1::uuid, $2::jsonb, NOW())
                                     ON CONFLICT (solicitud_id)
                                     DO UPDATE SET evaluacion_json = EXCLUDED.evaluacion_json, actualizado_en = NOW()`,
                                    [req.params.id, JSON.stringify(evaluacion)]
                                );
                            }
                        } catch (e) {
                            console.warn('[firmas] No se pudo marcar acta_generada:', e.message);
                        }
                    }
                    return res.json({ estado: nuevoEstado, firmaId: firma.id, pdfDisponible: !!pdfFirmadoPath, firmadoEn: info.firmado ? new Date() : null });
                } catch (_) {
                    return res.json({ estado: firma.estado, firmaId: firma.id, pdfDisponible: !!(firma.pdf_firmado_path || firma.pdf_path) });
                }
            }
            return res.json({ estado: firma.estado, firmaId: firma.id, pdfDisponible: !!(firma.pdf_firmado_path || firma.pdf_path) });
        } catch (err) {
            console.error('[firmas] Error estado acta:', err);
            res.status(500).json({ error: err.message });
        }
    });

    // Descargar PDF firmado del acta
    router.get('/juridica/solicitudes/:id/acta-pdf-firmado', async (req, res) => {
        try {
            const r = await pool.query(
                `SELECT pdf_firmado_path, pdf_path FROM actas_firmas WHERE solicitud_id = $1::uuid AND estado = 'firmado' ORDER BY creado_en DESC LIMIT 1`,
                [req.params.id]
            );
            if (r.rows.length === 0) return res.status(404).json({ error: 'PDF firmado no disponible aún' });
            const pdfFile = r.rows[0].pdf_firmado_path || r.rows[0].pdf_path;
            if (!pdfFile || !fs.existsSync(pdfFile))
                return res.status(404).json({ error: 'PDF firmado no disponible aún' });
            res.download(pdfFile, `Acta_Adjudicacion_firmada.pdf`);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    app.use('/api', router);

    // ============================================================
    // CRON: poll cada 60s acuerdos pendientes
    // ============================================================
    cron.schedule('*/60 * * * * *', async () => {
        try {
            const r = await pool.query(
                `SELECT * FROM firmas_documento
                  WHERE estado IN ('enviado','firmando')
                    AND agreement_id IS NOT NULL
                  ORDER BY ultima_consulta_en NULLS FIRST
                  LIMIT 20`
            );
            for (const firma of r.rows) {
                try {
                    await sincronizarFirma(pool, firma, FIRMAS_DIR);
                } catch (e) {
                    console.warn('[firmas:cron] error en', firma.id, e.message);
                }
            }
        } catch (e) {
            console.warn('[firmas:cron] fallo de polling:', e.message);
        }
    });

    console.log('[firmas] Rutas registradas y cron de polling activo (60s)');
}

// ============================================================
// Sincroniza el estado de UNA firma contra Adobe Sign
// ============================================================
async function sincronizarFirma(pool, firma, firmasDir) {
    const info = await obtenerEstadoAcuerdo(pool, firma.agreement_id);

    // Actualizar estado de la firma
    await pool.query(
        `UPDATE firmas_documento
            SET estado = $1,
                ultima_consulta_en = NOW(),
                actualizado_en = NOW(),
                completado_en = CASE WHEN $1 = 'firmado' THEN NOW() ELSE completado_en END
          WHERE id = $2`,
        [info.estadoInterno, firma.id]
    );

    // Actualizar firmantes individuales
    for (const fAd of info.firmantes || []) {
        await pool.query(
            `UPDATE firmantes_documento
                SET estado = CASE
                    WHEN $1 IN ('SIGNED','COMPLETED','APPROVED','ACCEPTED') THEN 'firmado'
                    WHEN $1 IN ('DECLINED','REJECTED','CANCELLED') THEN 'rechazado'
                    ELSE estado
                END,
                    firmado_en = CASE
                    WHEN $1 IN ('SIGNED','COMPLETED','APPROVED','ACCEPTED')
                      THEN COALESCE(firmado_en, NOW()) ELSE firmado_en
                END
              WHERE firma_id = $2 AND LOWER(email) = LOWER($3)`,
            [fAd.estado, firma.id, fAd.email]
        );
    }

    // Si está firmado, descargar PDF firmado
    if (info.firmado && !firma.pdf_firmado_path) {
        try {
            const carpeta = path.join(firmasDir, firma.solicitud_id);
            fs.mkdirSync(carpeta, { recursive: true });
            const destino = path.join(carpeta, `${firma.etapa}_FIRMADO_${Date.now()}.pdf`);
            await descargarPdfFirmado(pool, firma.agreement_id, destino);
            await pool.query(
                `UPDATE firmas_documento SET pdf_firmado_path = $1, actualizado_en = NOW() WHERE id = $2`,
                [destino, firma.id]
            );
        } catch (e) {
            console.warn('[firmas] Error descargando firmado:', e.message);
        }
    }

    return { estado: info.estadoInterno, estadoAdobe: info.estadoAdobe, firmantes: info.firmantes };
}

function formatearFechaCorta(d) {
    return d.toLocaleDateString('es-CO', { year: 'numeric', month: '2-digit', day: '2-digit' }).replace(/\//g, '-');
}

export default { registrarRutasFirmas };
