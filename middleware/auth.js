// ============================================================
// Middleware de autenticación — valida el ID token de Azure AD
// que MSAL ya emite en el login del frontend (mismo Client ID
// que AZURE_CLIENT_ID: esta app registration se usa tanto para
// el login de la SPA como para el flujo app-only de Graph).
//
// No requiere exponer una API nueva en el Portal de Azure: el
// token que valida es el mismo que el frontend ya obtiene al
// iniciar sesión (audience = AZURE_CLIENT_ID, issuer = tenant).
// ============================================================

import jwt from 'jsonwebtoken';
import jwksClient from 'jwks-rsa';

const RUTAS_PUBLICAS_EXACTAS = new Set([
    '/api/health',
    '/api/proveedores/buscar-por-documento',
]);

const RUTAS_PUBLICAS_PREFIJOS = [
    '/api/proponente/',
    '/api/convocatoria-publica/',
    '/api/adobe-sign/oauth/',
];

function esRutaPublica(path) {
    if (RUTAS_PUBLICAS_EXACTAS.has(path)) return true;
    return RUTAS_PUBLICAS_PREFIJOS.some((prefijo) => path.startsWith(prefijo));
}

/**
 * @param {import('pg').Pool} pool
 * @param {(evento: object) => Promise<void>} registrarLog
 * @param {(req: import('express').Request) => string} getClientIp
 */
export function crearMiddlewareAuth({ pool, registrarLog, getClientIp }) {
    const tenantId = process.env.AZURE_TENANT_ID;
    const audience = process.env.AZURE_CLIENT_ID;

    if (!tenantId || !audience) {
        console.error('[auth] AZURE_TENANT_ID / AZURE_CLIENT_ID no configurados — el middleware de autenticación rechazará todas las peticiones protegidas.');
    }

    const issuer = `https://login.microsoftonline.com/${tenantId}/v2.0`;
    const jwks = jwksClient({
        jwksUri: `https://login.microsoftonline.com/${tenantId}/discovery/v2.0/keys`,
        cache: true,
        cacheMaxAge: 24 * 60 * 60 * 1000,
        rateLimit: true,
        jwksRequestsPerMinute: 10,
    });

    function obtenerClavePublica(kid) {
        return new Promise((resolve, reject) => {
            jwks.getSigningKey(kid, (err, key) => {
                if (err) return reject(err);
                resolve(key.getPublicKey());
            });
        });
    }

    async function verificarToken(token) {
        const decodificado = jwt.decode(token, { complete: true });
        if (!decodificado?.header?.kid) throw new Error('Token sin encabezado kid');
        const clavePublica = await obtenerClavePublica(decodificado.header.kid);
        return new Promise((resolve, reject) => {
            jwt.verify(token, clavePublica, { audience, issuer, algorithms: ['RS256'] }, (err, payload) => {
                if (err) return reject(err);
                resolve(payload);
            });
        });
    }

    async function requireAuth(req, res, next) {
        if (esRutaPublica(req.path)) return next();

        const header = req.headers.authorization || '';
        const [esquema, token] = header.split(' ');
        if (esquema !== 'Bearer' || !token) {
            return res.status(401).json({ error: 'Se requiere autenticación' });
        }

        try {
            const payload = await verificarToken(token);
            const oid = payload.oid || payload.sub;
            const email = String(payload.preferred_username || payload.email || '').toLowerCase();

            let usuario = null;
            try {
                const r = await pool.query(
                    'SELECT id, rol FROM usuarios WHERE azure_id = $1 LIMIT 1',
                    [oid]
                );
                usuario = r.rows[0] || null;
            } catch (e) {
                console.error('[auth] Error consultando usuario por azure_id:', e.message);
            }

            req.auth = {
                oid,
                email,
                nombre: payload.name || null,
                usuarioId: usuario?.id || null,
                rol: usuario?.rol || null,
            };
            return next();
        } catch (err) {
            await registrarLog({
                tipo_log: 'seguridad', modulo: 'autenticacion', tabla: 'usuarios',
                registro_id: '00000000-0000-0000-0000-000000000003', accion: 'LOGIN',
                descripcion: `Token inválido o expirado (${req.method} ${req.path}): ${err.message}`,
                ip_address: getClientIp(req), resultado: 'fallido',
            });
            return res.status(401).json({ error: 'Token inválido o expirado' });
        }
    }

    function requireRole(...roles) {
        return (req, res, next) => {
            if (!req.auth || !roles.includes(req.auth.rol)) {
                return res.status(403).json({ error: 'No tiene permisos para esta acción' });
            }
            return next();
        };
    }

    return { requireAuth, requireRole };
}
