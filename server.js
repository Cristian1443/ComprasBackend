// ============================================================
// API Backend - Portal Compras y Contratación
// Express.js + node-postgres
// Puerto: 3001 (el frontend Vite corre en 3000)
// ============================================================

import express from 'express';
import cors from 'cors';
import pg from 'pg';
import dotenv from 'dotenv';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { registrarRutasFirmas } from './routes/firmas.js';
import { crearMiddlewareAuth } from './middleware/auth.js';
import { iniciarArchivadoAuditoria } from './jobs/archivarAuditoria.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Crear carpeta de uploads si no existe
const UPLOADS_DIR = path.join(__dirname, 'uploads', 'convocatorias');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
const SOLICITUDES_UPLOADS_DIR = path.join(__dirname, 'uploads', 'solicitudes');
fs.mkdirSync(SOLICITUDES_UPLOADS_DIR, { recursive: true });
const JURIDICA_UPLOADS_DIR = path.join(__dirname, 'uploads', 'juridica');
fs.mkdirSync(JURIDICA_UPLOADS_DIR, { recursive: true });
const FACTURAS_UPLOADS_DIR = path.join(__dirname, 'uploads', 'facturas');
fs.mkdirSync(FACTURAS_UPLOADS_DIR, { recursive: true });
const RECONOCIMIENTOS_UPLOADS_DIR = path.join(__dirname, 'uploads', 'reconocimientos');
fs.mkdirSync(RECONOCIMIENTOS_UPLOADS_DIR, { recursive: true });
const PROVEEDORES_UPLOADS_DIR = path.join(__dirname, 'uploads', 'proveedores');
fs.mkdirSync(PROVEEDORES_UPLOADS_DIR, { recursive: true });

// Configurar multer para guardar archivos
const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, `${unique}${ext}`);
    }
});
const upload = multer({
    storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB max por archivo
    fileFilter: (_req, file, cb) => {
        // Permitir PDFs, imágenes, Word, Excel, ZIP
        const allowed = /pdf|doc|docx|xls|xlsx|png|jpg|jpeg|gif|zip|rar|ppt|pptx/i;
        const ext = path.extname(file.originalname).slice(1);
        if (allowed.test(ext)) cb(null, true);
        else cb(new Error(`Tipo de archivo no permitido: .${ext}`));
    }
});

const solicitudesStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, SOLICITUDES_UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, `${unique}${ext}`);
    }
});

const uploadSolicitudes = multer({
    storage: solicitudesStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /pdf|doc|docx|xls|xlsx|png|jpg|jpeg|gif|zip|rar|ppt|pptx/i;
        const ext = path.extname(file.originalname).slice(1);
        if (allowed.test(ext)) cb(null, true);
        else cb(new Error(`Tipo de archivo no permitido: .${ext}`));
    }
});

const juridicaStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, JURIDICA_UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, `${unique}${ext}`);
    }
});
const uploadJuridica = multer({
    storage: juridicaStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /pdf|doc|docx|xls|xlsx|png|jpg|jpeg|gif|zip|rar|ppt|pptx/i;
        const ext = path.extname(file.originalname).slice(1);
        if (allowed.test(ext)) cb(null, true);
        else cb(new Error(`Tipo de archivo no permitido: .${ext}`));
    }
});

// Documentos legales/tributarios adjuntos al registro público de proveedor (RA1-4)
const proveedoresStorage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, PROVEEDORES_UPLOADS_DIR),
    filename: (_req, file, cb) => {
        const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
        const ext = path.extname(file.originalname);
        cb(null, `${unique}${ext}`);
    }
});
const uploadProveedores = multer({
    storage: proveedoresStorage,
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (_req, file, cb) => {
        const allowed = /pdf|png|jpg|jpeg/i;
        const ext = path.extname(file.originalname).slice(1);
        if (allowed.test(ext)) cb(null, true);
        else cb(new Error(`Tipo de archivo no permitido: .${ext}`));
    }
});
// Documentos que debe cargar el proponente, sin importar la modalidad de contratación
// (solo las filas resaltadas en amarillo del checklist oficial "Check list (V.F)" — el resto
// de filas del checklist, como Certificación Bancaria o Información Comercial, las genera
// internamente Jurídica/Cumplimiento y no se le piden al proponente en este formulario)
const DOCUMENTOS_PROVEEDOR_CAMPOS = ['rut', 'cedula_rl', 'camara_comercio', 'redam', 'antecedentes_fiscales', 'antecedentes_disciplinarios', 'antecedentes_judiciales'];
// Documentos adicionales que solo aplican cuando la convocatoria es de "Prestación de servicios profesionales"
const DOCUMENTOS_PROVEEDOR_CAMPOS_SERVICIOS_PROFESIONALES = ['hoja_vida', 'titulo_profesional', 'certificaciones_laborales'];
const DOCUMENTOS_PROVEEDOR_LABELS = {
    rut: 'RUT',
    cedula_rl: 'Cédula (persona natural / representante legal)',
    camara_comercio: 'Certificado de existencia y representación legal (Cámara de comercio)',
    redam: 'REDAM (Registro de Deudores Alimentarios Morosos)',
    antecedentes_fiscales: 'Antecedentes fiscales',
    antecedentes_disciplinarios: 'Antecedentes disciplinarios',
    antecedentes_judiciales: 'Antecedentes judiciales',
    hoja_vida: 'Hoja de vida',
    titulo_profesional: 'Título profesional',
    certificaciones_laborales: 'Certificaciones laborales',
};

// Documentos del checklist que solo aplican a proponentes tipo "empresa" (persona jurídica).
// El "Certificado de existencia y Rep. Legal" del PDF trae explícitamente "(personas jurídicas)".
const DOCUMENTOS_PROVEEDOR_CAMPOS_SOLO_EMPRESA = ['camara_comercio'];

// Calcula qué documentos debe cargar un proponente según su tipo de persona y el tipo de
// objeto contractual de la convocatoria — refleja el checklist oficial "Check list (V.F)".
function camposDocumentosRequeridos(tipoPersona, tipoObjeto) {
    let campos = DOCUMENTOS_PROVEEDOR_CAMPOS;
    if (tipoPersona === 'persona') {
        campos = campos.filter(c => !DOCUMENTOS_PROVEEDOR_CAMPOS_SOLO_EMPRESA.includes(c));
    }
    if (tipoObjeto === 'servicios_profesionales') {
        campos = [...campos, ...DOCUMENTOS_PROVEEDOR_CAMPOS_SERVICIOS_PROFESIONALES];
    }
    return campos;
}

// ─── Conexión PostgreSQL ───────────────────────────────────────
// (se crea antes que `app` porque el middleware de autenticación,
// montado más abajo justo después de CORS, necesita el pool ya listo)
const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'compras_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '1443',
    max: 10,
    idleTimeoutMillis: 30000,
});

const app = express();
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// No confiar en X-Forwarded-For salvo que se confirme un proxy real delante
// (ver TRUST_PROXY en .env.example). Por defecto usa la IP del socket.
app.set('trust proxy', (() => {
    const v = String(process.env.TRUST_PROXY || '').trim().toLowerCase();
    if (!v || v === 'false') return false;
    if (v === 'true') return true;
    const n = Number(v);
    return Number.isFinite(n) ? n : false;
})());

// CORS ampliado: acepta cualquier localhost (Vite, TS server, etc.)
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://localhost:5173',
    'http://127.0.0.1:3000',
    'http://127.0.0.1:5173',
    process.env.FRONTEND_URL,
].filter(Boolean);
app.use(cors({
    origin: (origin, callback) => {
        // Permitir sin origen (ej. curl, Postman, proxy interno de Vite)
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
            return callback(null, true);
        }
        return callback(new Error(`CORS bloqueado para: ${origin}`));
    },
    credentials: true,
}));

// Servir archivos subidos como estáticos
app.use('/api/uploads', express.static(path.join(__dirname, 'uploads')));

// ─── Autenticación (Azure AD) ─────────────────────────────────
// A partir de aquí, toda ruta requiere un Bearer token válido salvo las
// explícitamente públicas (proponentes externos, health check, callback
// OAuth de Adobe Sign) — ver middleware/auth.js.
const { requireAuth, requireRole } = crearMiddlewareAuth({ pool, registrarLog, getClientIp });
app.use(requireAuth);

// ─── RUTA: Subir anexos del solicitante ───────────────────────
// POST /api/solicitudes/upload
app.post('/api/solicitudes/upload', (req, res, next) => {
    uploadSolicitudes.array('archivos')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: 'Error al subir archivo: ' + err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    try {
        const files = Array.isArray(req.files) ? req.files : [];
        const archivos = files.map((file) => ({
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            nombre: file.originalname,
            tamanio: (file.size / 1024).toFixed(1) + ' KB',
            tipo: file.mimetype,
            fecha: new Date().toISOString(),
            nombre_almacenado: file.filename,
            url: `/api/uploads/solicitudes/${file.filename}`
        }));
        return res.status(201).json({ archivos });
    } catch (err) {
        console.error('Error subiendo anexos de solicitud:', err);
        return res.status(500).json({ error: 'Error al subir anexos de la solicitud' });
    }
});

// POST /api/solicitudes/:id/anexos — sube un archivo y lo agrega al JSON de anexos de la solicitud
app.post('/api/solicitudes/:id/anexos', (req, res, next) => {
    uploadSolicitudes.single('file')(req, res, function (err) {
        if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    const { id } = req.params;
    if (!req.file) return res.status(400).json({ error: 'No se recibio ningun archivo' });
    try {
        const nuevoAnexo = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            nombre: req.file.originalname,
            tamanio: (req.file.size / 1024).toFixed(1) + ' KB',
            tipo: req.file.mimetype,
            fecha: new Date().toISOString(),
            nombre_almacenado: req.file.filename,
            url: `/api/uploads/solicitudes/${req.file.filename}`,
        };
        // Leer anexos actuales y agregar el nuevo
        const solRes = await pool.query('SELECT anexos_solicitante FROM solicitudes WHERE id = $1', [id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
        let actuales = [];
        try { actuales = JSON.parse(solRes.rows[0].anexos_solicitante || '[]'); if (!Array.isArray(actuales)) actuales = []; } catch { actuales = []; }
        actuales.push(nuevoAnexo);
        await pool.query('UPDATE solicitudes SET anexos_solicitante = $1, actualizado_en = NOW() WHERE id = $2', [JSON.stringify(actuales), id]);
        return res.status(201).json({ archivo: nuevoAnexo });
    } catch (err) {
        console.error('Error agregando anexo:', err);
        return res.status(500).json({ error: 'Error al guardar el archivo' });
    }
});

// ─── Rate limiting para rutas públicas de proponentes ─────────
// Protege contra fuerza bruta de tokens: máx MAX_RPM peticiones/minuto por IP
const _rl = new Map(); // ip -> { count, resetAt }
const MAX_RPM = parseInt(process.env.RATE_LIMIT_RPM || '60');
function proponenteRateLimit(req, res, next) {
    const ip = getClientIp(req);
    const now = Date.now();
    const entry = _rl.get(ip) || { count: 0, resetAt: now + 60_000 };
    if (now > entry.resetAt) { entry.count = 1; entry.resetAt = now + 60_000; }
    else entry.count++;
    _rl.set(ip, entry);
    if (entry.count > MAX_RPM) {
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'Demasiadas solicitudes. Intente en un minuto.' });
    }
    next();
}
// Limpiar entradas expiradas cada 5 minutos para no acumular memoria
setInterval(() => {
    const now = Date.now();
    for (const [ip, e] of _rl) { if (now > e.resetAt) _rl.delete(ip); }
}, 300_000);

function normalizarModalidadContrato(valor) {
    const limpio = String(valor || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();

    if (limpio.includes('tdr')) return 'tdr';
    if (limpio.includes('invit')) return 'invitacion';
    return 'directa';
}

// ─── Middleware: verificar conexión ───────────────────────────
pool.connect((err) => {
    if (err) console.error('❌ Error conectando a PostgreSQL:', err.message);
    else console.log('✅ Conectado a PostgreSQL — compras_db');
});

// ─── Utilidades de Auditoría ──────────────────────────────────
// req.ip respeta `trust proxy` (ver arriba): por defecto ignora
// X-Forwarded-For y usa la IP real del socket, para que no sea
// falsificable por el cliente cuando no hay proxy confiable delante.
function getClientIp(req) {
    return req.ip || req.socket?.remoteAddress || '0.0.0.0';
}

/** Busca usuario por email; devuelve { id, rol } o null sin lanzar excepción. */
async function usuarioPorEmail(email) {
    if (!email) return null;
    try {
        const r = await pool.query(
            `SELECT id, rol FROM usuarios WHERE email = $1 AND activo = TRUE LIMIT 1`,
            [email]
        );
        return r.rows[0] || null;
    } catch { return null; }
}

/**
 * Registra un evento de auditoría de forma no bloqueante.
 * Nunca lanza excepción — un fallo de log no debe romper la operación principal.
 */
async function registrarLog({ tipo_log = 'negocio', modulo, tabla, registro_id, accion,
    campo = null, valor_anterior = null, valor_nuevo = null, descripcion = null,
    usuario_id = null, rol_usuario = null, ip_address = null, resultado = 'exitoso' }) {
    try {
        await pool.query(
            `INSERT INTO auditoria
                (tipo_log, modulo, tabla, registro_id, accion, campo,
                 valor_anterior, valor_nuevo, descripcion, usuario_id, rol_usuario, ip_address, resultado)
             VALUES ($1,$2,$3,$4::uuid,$5,$6,$7,$8,$9,$10,$11,$12::inet,$13)`,
            [tipo_log, modulo, tabla, registro_id, accion,
                campo, valor_anterior, valor_nuevo, descripcion,
                usuario_id || null, rol_usuario || null, ip_address || null, resultado]
        );
    } catch (e) {
        console.error('[audit] Error registrando log:', e.message);
    }
}

// ─── Rutas de firma electrónica (Adobe Acrobat Sign) ──────────
try {
    registrarRutasFirmas(app, pool, path.join(__dirname, 'uploads'));
} catch (e) {
    console.error('[firmas] No se pudieron registrar las rutas de firma:', e.message);
}

// ─── Archivado (no destructivo) de logs de auditoría vencidos ─
iniciarArchivadoAuditoria(pool, registrarLog);

/**
 * Devuelve la etapa de firma asociada a un cambio de estado.
 * Solo el comité mantiene firma electrónica; gerente, financiera y jurídica
 * usan estampa de tiempo al aprobar.
 */
function etapaFirmaRequerida(_nuevoEstado) {
    return null;
}

// Traduce la sigla registrada en `gerencias.nombre` al nombre completo usado en
// `presupuesto_vigencia.gerencia_nombre` (debe mantenerse sincronizado con
// GERENCIAS_FINANCIERA en compras-contratacion-frontend/src/components/financiera/PresupuestoVigencia.tsx).
const GERENCIA_NOMBRE_PRESUPUESTO = {
    GAF: 'Gerencia Administrativa y Financiera',
    GAE: 'Gerencia de Apoyo Estrategico',
    MERCADEO: 'Gerencia de Mercadeo y Comunicaciones',
    GPDI: 'Gerencia de Promocion e Inversion',
    BUREAU: 'Gerencia Bureau de Convenciones',
};

async function firmaCompletaPara(solicitudId, etapa) {
    if (!etapa) return true;
    const r = await pool.query(
        `SELECT estado FROM firmas_documento
          WHERE solicitud_id = $1 AND etapa = $2
          ORDER BY creado_en DESC LIMIT 1`,
        [solicitudId, etapa]
    );
    return r.rows[0]?.estado === 'firmado';
}

// ─── RUTA: Sincronizar usuario al iniciar sesión en Azure ─────
// El frontend llama esto justo después del login de MSAL
// POST /api/auth/sync
// Body: { azure_id, email, nombre, cargo, departamento }
app.post('/api/auth/sync', async (req, res) => {
    const { azure_id, email, nombre, cargo, departamento } = req.body;

    if (!azure_id || !email || !nombre) {
        return res.status(400).json({ error: 'azure_id, email y nombre son requeridos' });
    }

    // El body lo autodeclara el cliente; debe coincidir con la identidad ya
    // verificada del token (req.auth) para no permitir que alguien sincronice
    // datos a nombre de otro usuario.
    const mismaIdentidad = req.auth?.oid === azure_id
        && String(req.auth?.email || '').toLowerCase() === String(email).toLowerCase();
    if (!mismaIdentidad) {
        await registrarLog({
            tipo_log: 'seguridad', modulo: 'autenticacion', tabla: 'usuarios',
            registro_id: '00000000-0000-0000-0000-000000000003', accion: 'LOGIN',
            descripcion: `Intento de sincronizar identidad no coincidente con el token: body=${email}/${azure_id}, token=${req.auth?.email}/${req.auth?.oid}`,
            ip_address: getClientIp(req), resultado: 'fallido'
        });
        return res.status(403).json({ error: 'La identidad enviada no coincide con la sesión autenticada' });
    }

    try {
        const result = await pool.query(
            `SELECT * FROM sincronizar_usuario($1, $2, $3, $4, $5)`,
            [azure_id, email, nombre, cargo || null, departamento || null]
        );

        const user = result.rows[0];
        console.log(`🔐 Login: ${email} → rol: ${user.rol} ${user.es_nuevo ? '(nuevo)' : '(existente)'}`);

        await registrarLog({
            tipo_log: 'acceso', modulo: 'autenticacion', tabla: 'usuarios',
            registro_id: user.id, accion: 'LOGIN',
            descripcion: `Inicio de sesión exitoso: ${nombre} (${email})`,
            usuario_id: user.id, rol_usuario: user.rol,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({
            id: user.id,
            rol: user.rol,
            gerencia_id: user.gerencia_id,
            gerencia_nombre: user.gerencia_nombre,
            es_nuevo: user.es_nuevo
        });
    } catch (err) {
        console.error('Error sincronizando usuario:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});

// ─── RUTA: Obtener perfil del usuario actual ─────────────────
// GET /api/usuarios/me — el email viene de la identidad ya verificada del token,
// nunca del query string (evita que alguien consulte el perfil de otro usuario).
app.get('/api/usuarios/me', async (req, res) => {
    const email = req.auth?.email;
    if (!email) return res.status(400).json({ error: 'email requerido' });

    try {
        const result = await pool.query(
            `UPDATE usuarios
             SET ultimo_acceso = NOW(), actualizado_en = NOW()
             WHERE email = $1 AND activo = TRUE
             RETURNING id`,
            [email]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const full = await pool.query(
            `SELECT u.*, g.nombre AS gerencia_nombre
             FROM usuarios u
             LEFT JOIN gerencias g ON u.gerencia_id = g.id
             WHERE u.email = $1`,
            [email]
        );
        return res.json(full.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error interno' });
    }
});

// ─── RUTA: Listar usuarios (para selección de supervisores) ──
app.get('/api/usuarios', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT u.id, u.nombre, u.email, u.cargo, g.nombre AS gerencia_nombre
             FROM usuarios u
             LEFT JOIN gerencias g ON u.gerencia_id = g.id
             WHERE u.activo = TRUE
             ORDER BY u.nombre`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// ─── RUTA: Listar gerencias ────────────────────────────────────
app.get('/api/gerencias', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre, codigo FROM gerencias WHERE activa = TRUE ORDER BY nombre`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener gerencias' });
    }
});

// ─── RUTA: Listar rubros presupuestales ────────────────────────
app.get('/api/rubros', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, codigo, nombre, gerencia_nombre FROM rubros_presupuestales WHERE activo = TRUE ORDER BY gerencia_nombre, codigo`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener rubros' });
    }
});

// ─── RUTA: Listar solicitudes ────────────────────────────────
// GET /api/solicitudes?email=xxx&estado=xxx
app.get('/api/solicitudes', async (req, res) => {
    const { email, estado } = req.query;

    try {
        let query = `
            SELECT
                v.*,
                s.resultado_comite,
                s.comentario_comite,
                s.fecha_comite_decision
            FROM v_solicitudes_resumen v
            LEFT JOIN solicitudes s ON s.id = v.id
        `;
        let params = [];
        let conditions = [];

        if (email) {
            conditions.push(`LOWER(v.solicitante_email) = LOWER($${params.length + 1})`);
            params.push(String(email).trim());
        }

        if (estado) {
            conditions.push(`v.estado = $${params.length + 1}`);
            params.push(estado);
        }

        if (conditions.length > 0) {
            query += ` WHERE ${conditions.join(' AND ')}`;
        }

        query += ` ORDER BY v.creado_en DESC`;

        const result = await pool.query(query, params);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error interno' });
    }
});

// ─── RUTA: Obtener detalle de una solicitud individual ─────────
// GET /api/solicitudes/:id
app.get('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;

    try {
        // 1. Datos básicos desde la vista de resumen
        const resumenResult = await pool.query(
            `SELECT * FROM v_solicitudes_resumen WHERE id = $1`,
            [id]
        );

        if (resumenResult.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        const solicitud = resumenResult.rows[0];

        // 1.1 Completar con datos completos desde tabla solicitudes
        // (la vista de resumen NO incluye todos los campos diligenciados)
        const fullResult = await pool.query(
            `SELECT * FROM solicitudes WHERE id = $1`,
            [id]
        );
        if (fullResult.rows.length > 0) {
            Object.assign(solicitud, fullResult.rows[0]);
        }

        // Parsear campos TEXT que se guardan como JSON stringificado
        const jsonTextFields = ['entregables_detalle', 'obligaciones_especificas', 'anexos_solicitante', 'criterios_habilitantes_planeacion'];
        for (const field of jsonTextFields) {
            if (solicitud[field] && typeof solicitud[field] === 'string') {
                try { solicitud[field] = JSON.parse(solicitud[field]); } catch { solicitud[field] = []; }
            }
        }

        // 2. Datos de modalidad — modalidad_seleccion y justificacion_cd (Causal
        // de contratación) solo existen en esta tabla, no en `solicitudes`.
        // Se aplanan al nivel superior porque DetallePlaneacionContractual.tsx
        // (usado por Gerente, Financiera, Jurídica y Riesgos) lee s.modalidad_seleccion
        // directamente, no s.info_modalidad.modalidad_seleccion.
        const modalidadResult = await pool.query(
            `SELECT * FROM solicitudes_modalidad_directa WHERE solicitud_id = $1`,
            [id]
        );
        solicitud.info_modalidad = modalidadResult.rows[0] || {};
        // Solo modalidad_seleccion/justificacion_cd (Causal de contratación): no
        // copiar el resto de la fila (id/solicitud_id/actualizado_en pisarían los
        // del registro principal, y fecha_estimada_* ya viven en `solicitudes`
        // para todas las modalidades — sobreescribirlas aquí las borraría
        // cuando esta tabla no tiene fila, como en Invitación/TDR).
        if (modalidadResult.rows[0]) {
            solicitud.modalidad_seleccion = modalidadResult.rows[0].modalidad_seleccion;
            solicitud.justificacion_cd = modalidadResult.rows[0].justificacion_cd;
        }

        // 3. Datos avanzados (Jurídica)
        // Esta tabla puede no existir aún en algunas bases (según migraciones aplicadas),
        // por eso se envuelve en un try/catch y se ignora el error "relation does not exist".
        try {
            const detalleJuridicoResult = await pool.query(
                `SELECT * FROM solicitudes_detalle_juridico WHERE solicitud_id = $1`,
                [id]
            );
            solicitud.detalle_juridico = detalleJuridicoResult.rows[0] || {};
        } catch (e) {
            // Código 42P01 = relation does not exist
            if (e && e.code !== '42P01') {
                console.error('Error cargando detalle jurídico:', e);
            }
            solicitud.detalle_juridico = {};
        }

        // 4. Proponentes
        const proponentesResult = await pool.query(
            `SELECT * FROM proponentes WHERE solicitud_id = $1 ORDER BY numero ASC`,
            [id]
        );
        solicitud.proponentes = proponentesResult.rows;

        // 5. Anexos (anexos_documentos)
        try {
            const anexosResult = await pool.query(
                `SELECT nombre_documento, tipo, fecha_documento, archivo_url, archivo_nombre_original
                 FROM anexos_documentos
                 WHERE solicitud_id = $1
                 ORDER BY fecha_documento NULLS LAST, nombre_documento`,
                [id]
            );
            solicitud.anexosDocs = anexosResult.rows;
        } catch (e) {
            console.error('Error cargando anexos de solicitud:', e);
            solicitud.anexosDocs = [];
        }

        // 6. Conteo de invitaciones
        try {
            const invResult = await pool.query(
                `SELECT COUNT(*) as total FROM convocatorias WHERE solicitud_id = $1`,
                [id]
            );
            solicitud.total_invitaciones = parseInt(invResult.rows[0].total || '0', 10);
        } catch (e) {
            solicitud.total_invitaciones = 0;
        }

        // 7. Número de acta del Comité — vive en actas_comite (solicitudes_ids), no en la tabla solicitudes
        try {
            const actaResult = await pool.query(
                `SELECT acta_numero FROM actas_comite WHERE $1::text = ANY(solicitudes_ids) ORDER BY fecha_sesion DESC LIMIT 1`,
                [id]
            );
            solicitud.acta_numero = actaResult.rows[0]?.acta_numero || null;
        } catch (e) {
            if (e && e.code !== '42P01') {
                console.error('Error cargando número de acta:', e);
            }
            solicitud.acta_numero = null;
        }

        return res.json(solicitud);
    } catch (err) {
        console.error('Error al obtener detalle:', err);
        return res.status(500).json({ error: 'Error interno del servidor' });
    }
});


// ─── RUTA: Actualizar estado de solicitud (Gerente/Financiera/Juridica/etc.) ──
// PATCH /api/solicitudes/:id/estado
app.patch('/api/solicitudes/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado, comentario, gerente_id, financiera_id, rubro, presupuesto_aprobado } = req.body;

    if (!estado) return res.status(400).json({ error: 'estado requerido' });

    // ── BLOQUEO POR FIRMA: la solicitud no avanza hasta que la firma de
    // la etapa correspondiente esté en estado 'firmado'.
    const etapaReq = etapaFirmaRequerida(estado);
    if (etapaReq) {
        const ok = await firmaCompletaPara(id, etapaReq);
        if (!ok) {
            return res.status(409).json({
                error: 'firma_requerida',
                etapa: etapaReq,
                mensaje: `Falta completar la firma electrónica de la etapa "${etapaReq}" antes de avanzar.`,
            });
        }
    }

    // ── BLOQUEO POR PRESUPUESTO: el gerente no puede aprobar (pasar a
    // en_financiera) si la gerencia solicitante no tiene Disponible Real (>0)
    // cargado en la vigencia actual.
    if (estado === 'en_financiera') {
        const vigenciaActual = new Date().getFullYear();
        // `gerencias.nombre` guarda la sigla (GAF, GAE, MERCADEO, GPDI, BUREAU) mientras que
        // `presupuesto_vigencia.gerencia_nombre` guarda el nombre completo (ver GERENCIAS_FINANCIERA
        // en el frontend). Hay que traducir la sigla antes de buscar el presupuesto cargado.
        const gerRes = await pool.query(
            `SELECT g.nombre FROM solicitudes s JOIN gerencias g ON g.id = s.gerencia_id WHERE s.id = $1`,
            [id]
        );
        const siglaGerencia = String(gerRes.rows[0]?.nombre || '').trim().toUpperCase();
        const gerenciaNombreCompleto = GERENCIA_NOMBRE_PRESUPUESTO[siglaGerencia] || gerRes.rows[0]?.nombre || '';
        const presRes = await pool.query(
            `SELECT
                (pv.monto_total
                    - pv.comprometido_vigencia_anterior
                    - COALESCE(SUM(s2.presupuesto_aprobado) FILTER (WHERE s2.estado IN ('aprobado_juridica','finalizado','contratado','cerrado')), 0)
                    - COALESCE(SUM(s2.presupuesto_aprobado) FILTER (WHERE s2.estado IN ('aprobado_financiera','aprobado_comite','en_juridica','enviado_juridica','en_juridica_concepto','en_riesgos','en_comite')), 0)
                )::bigint AS disponible
             FROM presupuesto_vigencia pv
             LEFT JOIN solicitudes s2 ON s2.rubro = pv.gerencia_nombre AND EXTRACT(YEAR FROM s2.actualizado_en) = pv.vigencia
             WHERE pv.gerencia_nombre = $1 AND pv.vigencia = $2
             GROUP BY pv.id, pv.monto_total, pv.comprometido_vigencia_anterior`,
            [gerenciaNombreCompleto, vigenciaActual]
        );
        const disponible = presRes.rows.length ? Number(presRes.rows[0].disponible) : 0;
        if (disponible <= 0) {
            return res.status(409).json({
                error: 'presupuesto_insuficiente',
                mensaje: 'La gerencia solicitante no tiene presupuesto disponible en la vigencia actual. No es posible aprobar esta solicitud.',
            });
        }
    }

    try {
        const result = await pool.query(
            `UPDATE solicitudes 
             SET estado = $1::estado_solicitud, 
                 comentario_gerente = CASE WHEN $1::text IN ('aprobado_gerente', 'en_financiera', 'rechazado_gerente', 'devuelto_al_solicitante') THEN COALESCE($2, comentario_gerente) ELSE comentario_gerente END,
                 comentario_financiera = CASE WHEN $1::text IN ('aprobado_financiera', 'rechazado_financiera') THEN COALESCE($2, comentario_financiera) ELSE comentario_financiera END,
                 gerente_id = COALESCE($3, gerente_id),
                 financiera_id = COALESCE($4, financiera_id),
                 rubro = COALESCE($5, rubro),
                 presupuesto_aprobado = COALESCE($6, presupuesto_aprobado),
                 fecha_respuesta_gerente = CASE WHEN $1::text IN ('aprobado_gerente', 'en_financiera', 'rechazado_gerente', 'devuelto_al_solicitante') THEN NOW() ELSE fecha_respuesta_gerente END,
                 fecha_respuesta_financiera = CASE WHEN $1::text IN ('aprobado_financiera', 'rechazado_financiera') THEN NOW() ELSE fecha_respuesta_financiera END,
                 actualizado_en = NOW()
              WHERE id = $7
              RETURNING id, codigo, estado`,
            [estado, comentario, gerente_id || null, financiera_id || null, rubro || null, presupuesto_aprobado || null, id]
        );

        if (result.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });

        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar estado' });
    }
});


// ─── RUTA: Crear nueva solicitud ─────────────────────────────
// POST /api/solicitudes
app.post('/api/solicitudes', async (req, res) => {
    const {
        email, justificacion, descripcion_necesidad_detalle, titulo_contrato, objeto, lugar_ejecucion,
        plazo_ejecucion_meses, plazo_ejecucion_dias, modalidad, valor_estimado,
        moneda, valor_moneda_cop, valor_moneda_usd, valor_moneda_eur,
        valor_moneda_cop_texto, valor_moneda_usd_texto, valor_moneda_eur_texto,
        efecto_estimar_presupuesto, forma_pago, rubro_presupuestal,
        criterios_contratacion, fecha_comite, modalidad_seleccion, justificacion_cd,
        supervision_id, supervisor, entregables, anexos_texto, anexos_solicitante, riesgos, criterios_ambientales_sst, conclusiones_comite,
        analisis_servicios_ofertados, analisis_valor_promedio, analisis_plazo_promedio, analisis_presupuesto_oficial,
        entregable1, entregable2, entregable3,
        proponentes, anexos, porcentaje_anticipo
    } = req.body;

    try {
        const modalidadNormalizada = normalizarModalidadContrato(modalidad);
        const userResult = await pool.query(
            'SELECT id, gerencia_id FROM usuarios WHERE email = $1', [email]
        );
        if (userResult.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const { id: solicitante_id, gerencia_id } = userResult.rows[0];

        // 1.5 Asegurar que el supervisor existe y obtener su ID interno
        // Usamos ensureUsuarioExists (NO sincronizar_usuario) para no actualizar ultimo_acceso
        // cuando el usuario es mencionado como supervisor, no está haciendo login.
        let internal_supervision_id = null;
        if (supervisor && supervisor.id) {
            internal_supervision_id = await ensureUsuarioExists(
                supervisor.id, supervisor.email, supervisor.nombre, supervisor.cargo || null
            );
        } else if (supervision_id) {
            // Si llega solo el ID (ya sea Azure ID o el UUID interno de la DB)
            const supRes = await pool.query(
                'SELECT id FROM usuarios WHERE id::text = $1 OR azure_id = $1 OR email = $1',
                [supervision_id]
            );
            if (supRes.rows.length > 0) internal_supervision_id = supRes.rows[0].id;
        }

        const result = await pool.query(`
      INSERT INTO solicitudes (
        solicitante_id, gerencia_id, justificacion, descripcion_necesidad, descripcion_necesidad_detalle, titulo_contrato, objeto,
        lugar_ejecucion, plazo_ejecucion_meses, plazo_ejecucion_dias,
        modalidad, valor_estimado, moneda, valor_en_cop,
        valor_moneda_cop, valor_moneda_usd, valor_moneda_eur,
        valor_moneda_cop_texto, valor_moneda_usd_texto, valor_moneda_eur_texto,
        efecto_estimar_presupuesto, forma_pago, rubro_presupuestal,
        criterios_contratacion, fecha_comite, modalidad_seleccion, justificacion_cd,
        supervision_id, entregables, anexos_texto, anexos_solicitante, riesgos, criterios_ambientales_sst, conclusiones_comite,
        analisis_servicios_ofertados, analisis_valor_promedio, analisis_plazo_promedio_meses, analisis_plazo_promedio_dias, analisis_presupuesto_oficial,
        entregable1, entregable2, entregable3,
        justificacion_anticipo,
        obligaciones_especificas, entregables_detalle,
        fecha_estimada_solicitud, fecha_estimada_recepcion,
        porcentaje_anticipo,
        experiencia_acreditada_exigida, criterios_habilitantes_planeacion,
        estado
      ) VALUES ($1,$2,$3,$3,$4,$33,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,nullif($23,'')::date,$24,$25,$26,$27,$28,$29,$30,$31,$32,$34,$35,$40,$41,$36,$37,$38,$39,$42,$43,$44,nullif($45,'')::date,nullif($46,'')::date,$47,$48,$49,'borrador')
      RETURNING id, codigo, estado, creado_en`,
            [
                solicitante_id, gerencia_id, justificacion, descripcion_necesidad_detalle, objeto,
                lugar_ejecucion, plazo_ejecucion_meses || 0, plazo_ejecucion_dias || 0,
                modalidadNormalizada, valor_estimado, moneda, req.body.valor_en_cop || 0,
                valor_moneda_cop || 0, valor_moneda_usd || 0, valor_moneda_eur || 0,
                valor_moneda_cop_texto || null, valor_moneda_usd_texto || null, valor_moneda_eur_texto || null,
                efecto_estimar_presupuesto, forma_pago, rubro_presupuestal,
                criterios_contratacion, fecha_comite || null, modalidad_seleccion, justificacion_cd,
                internal_supervision_id, entregables, anexos_texto,
                JSON.stringify(anexos_solicitante || []),
                riesgos, criterios_ambientales_sst, conclusiones_comite,
                titulo_contrato || null,
                analisis_servicios_ofertados || null, analisis_valor_promedio || null,
                analisis_presupuesto_oficial || null,
                entregable1 || null, entregable2 || null, entregable3 || null,
                req.body.analisis_plazo_promedio_meses || null, req.body.analisis_plazo_promedio_dias || null,
                req.body.justificacion_anticipo || null,
                JSON.stringify(req.body.obligaciones_especificas || []),
                JSON.stringify(req.body.entregables_detalle || []),
                req.body.fecha_estimada_solicitud || null,
                req.body.fecha_estimada_recepcion || null,
                porcentaje_anticipo || null,
                req.body.experiencia_acreditada_exigida || null,
                JSON.stringify(req.body.criterios_habilitantes_planeacion || [])
            ]
        );

        const nuevaSolicitud = result.rows[0];
        const solicitudId = nuevaSolicitud.id;

        // 2. Guardar proponentes si vienen en el payload
        const proponentesArray = Array.isArray(proponentes) ? proponentes : [];
        if (proponentesArray.length > 0) {
            for (let i = 0; i < proponentesArray.length; i++) {
                const p = proponentesArray[i];
                if (!p) continue;

                const numero = i + 1;
                const nombreProveedor = p.nombreProveedor || p.nombre_proveedor || null;

                if (!nombreProveedor) continue; // Evitar filas totalmente vacías

                await pool.query(
                    `INSERT INTO proponentes (
                        solicitud_id, numero, nombre_proveedor, datos_contacto,
                        requisitos_tecnicos, experiencia, criterios_habilitantes,
                        valor_con_impuestos, valor_agregado, moneda, observaciones, correo,
                        valor_cotizacion, plazo_meses, plazo_dias
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                    [
                        solicitudId,
                        numero,
                        nombreProveedor,
                        p.datosContacto || p.datos_contacto || null,
                        p.requisitosTecnicos || p.requisitos_tecnicos || null,
                        p.experiencia || null,
                        p.criteriosHabilitantes || p.criterios_habilitantes || null,
                        p.valorImpuestos ? Number(p.valorImpuestos) : null,
                        (p.valorAgregado ?? p.valor_agregado ?? null),
                        p.moneda || moneda || 'COP',
                        p.observaciones || null,
                        p.correo || null,
                        p.valorCotizacion || p.valor_cotizacion || null,
                        p.plazoMeses ? Number(p.plazoMeses) : (p.plazo_meses ? Number(p.plazo_meses) : null),
                        p.plazoDias ? Number(p.plazoDias) : (p.plazo_dias ? Number(p.plazo_dias) : null),
                    ]
                );
            }
        }

        // 3. Guardar anexos (anexos_documentos)
        const anexosArray = Array.isArray(anexos) ? anexos : [];
        if (anexosArray.length > 0) {
            for (const a of anexosArray) {
                if (!a) continue;
                const nombreDocumento = a.nombre || a.nombre_documento;
                if (!nombreDocumento) continue;

                await pool.query(
                    `INSERT INTO anexos_documentos (
                        solicitud_id, nombre_documento, tipo, fecha_documento, archivo_url, archivo_nombre_original
                    )
                    VALUES ($1,$2,$3,nullif($4,'')::date,$5,$6)`,
                    [
                        solicitudId,
                        nombreDocumento,
                        a.tipo || null,
                        a.fecha || a.fecha_documento || null,
                        a.archivoUrl || a.archivo_url || null,
                        a.archivoNombre || a.archivo_nombre_original || null,
                    ]
                );
            }
        }

        return res.status(201).json(nuevaSolicitud);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al crear solicitud: ' + (err.message || err.toString()), stack: err.stack });
    }
});

// ─── RUTA: Actualizar solicitud existente (guardar borrador) ─
// PUT /api/solicitudes/:id
app.put('/api/solicitudes/:id', async (req, res) => {
    const { id } = req.params;
    const {
        email, justificacion, descripcion_necesidad_detalle, titulo_contrato, objeto, lugar_ejecucion,
        plazo_ejecucion_meses, plazo_ejecucion_dias, modalidad, valor_estimado,
        moneda, valor_moneda_cop, valor_moneda_usd, valor_moneda_eur,
        valor_moneda_cop_texto, valor_moneda_usd_texto, valor_moneda_eur_texto,
        efecto_estimar_presupuesto, forma_pago, rubro_presupuestal,
        criterios_contratacion, fecha_comite, modalidad_seleccion, justificacion_cd,
        supervision_id, supervisor, entregables, anexos_texto, anexos_solicitante, riesgos, criterios_ambientales_sst, conclusiones_comite,
        analisis_servicios_ofertados, analisis_valor_promedio, analisis_plazo_promedio, analisis_presupuesto_oficial,
        entregable1, entregable2, entregable3,
        proponentes, anexos, porcentaje_anticipo
    } = req.body;

    try {
        const modalidadNormalizada = normalizarModalidadContrato(modalidad);
        let actualizado_por = null;
        if (email) {
            const userResult = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
            if (userResult.rows.length > 0) actualizado_por = userResult.rows[0].id;
        }

        // Asegurar que el supervisor existe y obtener su ID interno
        // Usamos ensureUsuarioExists (NO sincronizar_usuario) para no actualizar ultimo_acceso
        let internal_supervision_id = null;
        if (supervisor && supervisor.id) {
            internal_supervision_id = await ensureUsuarioExists(
                supervisor.id, supervisor.email, supervisor.nombre, supervisor.cargo || null
            );
        } else if (supervision_id) {
            const supRes = await pool.query(
                'SELECT id FROM usuarios WHERE id::text = $1 OR azure_id = $1 OR email = $1',
                [supervision_id]
            );
            if (supRes.rows.length > 0) internal_supervision_id = supRes.rows[0].id;
        }

        const result = await pool.query(`
            UPDATE solicitudes 
            SET justificacion = $1,
                descripcion_necesidad = $1,
                descripcion_necesidad_detalle = $2,
                objeto = $3,
                lugar_ejecucion = $4,
                plazo_ejecucion_meses = $5,
                plazo_ejecucion_dias = $6,
                modalidad = $7,
                valor_estimado = $8,
                moneda = $9,
                valor_en_cop = $10,
                valor_moneda_cop = $11,
                valor_moneda_usd = $12,
                valor_moneda_eur = $13,
                valor_moneda_cop_texto = $14,
                valor_moneda_usd_texto = $15,
                valor_moneda_eur_texto = $16,
                efecto_estimar_presupuesto = $17,
                forma_pago = $18,
                rubro_presupuestal = $19,
                criterios_contratacion = $20,
                fecha_comite = nullif($21,'')::date,
                modalidad_seleccion = $22,
                justificacion_cd = $23,
                supervision_id = $24,
                entregables = $25,
                anexos_texto = $26,
                riesgos = $27,
                criterios_ambientales_sst = $28,
                conclusiones_comite = $29,
                anexos_solicitante = $32,
                titulo_contrato = $33,
                analisis_servicios_ofertados = $34,
                analisis_valor_promedio = $35,
                analisis_plazo_promedio_meses = $36,
                analisis_presupuesto_oficial = $37,
                analisis_plazo_promedio_dias = $41,
                justificacion_anticipo = $42,
                obligaciones_especificas = $43,
                entregables_detalle = $44,
                entregable1 = $38,
                entregable2 = $39,
                entregable3 = $40,
                fecha_estimada_solicitud = nullif($45,'')::date,
                fecha_estimada_recepcion = nullif($46,'')::date,
                porcentaje_anticipo = $47,
                experiencia_acreditada_exigida = $48,
                criterios_habilitantes_planeacion = $49,
                actualizado_en = NOW(),
                actualizado_por = COALESCE($31, actualizado_por)
            WHERE id = $30
            RETURNING id, codigo, estado`,
            [
                justificacion, descripcion_necesidad_detalle, objeto, lugar_ejecucion,
                plazo_ejecucion_meses || 0, plazo_ejecucion_dias || 0,
                modalidadNormalizada, valor_estimado, moneda, req.body.valor_en_cop || 0,
                valor_moneda_cop || 0, valor_moneda_usd || 0, valor_moneda_eur || 0,
                valor_moneda_cop_texto || null, valor_moneda_usd_texto || null, valor_moneda_eur_texto || null,
                efecto_estimar_presupuesto, forma_pago, rubro_presupuestal,
                criterios_contratacion, fecha_comite || null, modalidad_seleccion, justificacion_cd,
                internal_supervision_id, entregables, anexos_texto, riesgos, criterios_ambientales_sst, conclusiones_comite,
                id, actualizado_por, JSON.stringify(anexos_solicitante || []),
                titulo_contrato || null,
                analisis_servicios_ofertados || null, analisis_valor_promedio || null,
                req.body.analisis_plazo_promedio_meses || null, analisis_presupuesto_oficial || null,
                entregable1 || null, entregable2 || null, entregable3 || null,
                req.body.analisis_plazo_promedio_dias || null,
                req.body.justificacion_anticipo || null,
                JSON.stringify(req.body.obligaciones_especificas || []),
                JSON.stringify(req.body.entregables_detalle || []),
                req.body.fecha_estimada_solicitud || null,
                req.body.fecha_estimada_recepcion || null,
                porcentaje_anticipo || null,
                req.body.experiencia_acreditada_exigida || null,
                JSON.stringify(req.body.criterios_habilitantes_planeacion || [])
            ]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        const solicitudActualizada = result.rows[0];

        // 2. Actualizar proponentes (se borran y se vuelven a insertar)
        const proponentesArray = Array.isArray(proponentes) ? proponentes : [];
        await pool.query('DELETE FROM proponentes WHERE solicitud_id = $1', [id]);
        if (proponentesArray.length > 0) {
            for (let i = 0; i < proponentesArray.length; i++) {
                const p = proponentesArray[i];
                if (!p) continue;

                const numero = i + 1;
                const nombreProveedor = p.nombreProveedor || p.nombre_proveedor || null;

                if (!nombreProveedor) continue;

                const cleanNumber = (val) => {
                    if (val === null || val === undefined || val === '') return null;
                    if (typeof val === 'number') return val;
                    // Eliminar símbolos de moneda, espacios y puntos de miles, convertir coma decimal en punto
                    const cleaned = String(val).replace(/[$\s.]/g, '').replace(',', '.');
                    const num = Number(cleaned);
                    return isNaN(num) ? null : num;
                };

                await pool.query(
                    `INSERT INTO proponentes (
                        solicitud_id, numero, nombre_proveedor, datos_contacto,
                        requisitos_tecnicos, experiencia, criterios_habilitantes,
                        valor_con_impuestos, valor_agregado, moneda, observaciones, correo,
                        valor_cotizacion, plazo_meses, plazo_dias
                    )
                    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
                    [
                        id,
                        numero,
                        p.nombreProveedor || p.nombre_proveedor || null,
                        p.datosContacto || p.datos_contacto || null,
                        p.requisitosTecnicos || p.requisitos_tecnicos || null,
                        p.experiencia || null,
                        p.criteriosHabilitantes || p.criterios_habilitantes || null,
                        cleanNumber(p.valorImpuestos || p.valor_con_impuestos),
                        (p.valorAgregado ?? p.valor_agregado ?? null),
                        p.moneda || moneda || 'COP',
                        p.observaciones || null,
                        p.correo || null,
                        p.valorCotizacion || p.valor_cotizacion || null,
                        p.plazoMeses ? Number(p.plazoMeses) : (p.plazo_meses ? Number(p.plazo_meses) : null),
                        p.plazoDias ? Number(p.plazoDias) : (p.plazo_dias ? Number(p.plazo_dias) : null),
                    ]
                );
            }
        }

        // 3. Actualizar anexos (anexos_documentos)
        const anexosArray = Array.isArray(anexos) ? anexos : [];
        await pool.query('DELETE FROM anexos_documentos WHERE solicitud_id = $1', [id]);
        if (anexosArray.length > 0) {
            for (const a of anexosArray) {
                if (!a) continue;
                const nombreDocumento = a.nombre || a.nombre_documento;
                if (!nombreDocumento) continue;

                await pool.query(
                    `INSERT INTO anexos_documentos (
                        solicitud_id, nombre_documento, tipo, fecha_documento, archivo_url, archivo_nombre_original
                    )
                    VALUES ($1,$2,$3,nullif($4,'')::date,$5,$6)`,
                    [
                        id,
                        nombreDocumento,
                        a.tipo || null,
                        a.fecha || a.fecha_documento || null,
                        a.archivoUrl || a.archivo_url || null,
                        a.archivoNombre || a.archivo_nombre_original || null,
                    ]
                );
            }
        }

        return res.json(solicitudActualizada);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar solicitud: ' + (err.message || err.toString()), stack: err.stack });
    }
});

// ─── RUTA: Finalizar y cerrar solicitud (Supervisor) ──────────
// PUT /api/solicitudes/:id/finalizar
app.put('/api/solicitudes/:id/finalizar', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `UPDATE solicitudes
             SET estado = 'finalizado',
                 fecha_fin_contrato = COALESCE(fecha_fin_contrato, NOW()::date),
                 actualizado_en = NOW()
             WHERE id = $1 AND estado = 'aprobado_financiera'
             RETURNING id, codigo, estado`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada o no está en estado para finalizar' });
        }
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al finalizar solicitud' });
    }
});

// ─── RUTAS PARA SUPERVISOR: Contratos asignados y evaluación ──
// GET /api/supervisor/contratos?email=xxx
// Lista contratos donde el usuario es supervisor (no solicitante), excluye borrador
app.get('/api/supervisor/contratos', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });

    try {
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const userId = userRes.rows[0].id;

        const result = await pool.query(
            `SELECT s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.moneda, s.valor_en_cop, s.valor_estimado,
                    s.valor_moneda_cop_texto, s.valor_moneda_usd_texto, s.valor_moneda_eur_texto,
                    s.plazo_ejecucion_meses, s.plazo_ejecucion_dias, s.creado_en,
                    u_sol.nombre AS solicitante_nombre,
                    (SELECT p.nombre_proveedor FROM proponentes p
                     WHERE p.solicitud_id = s.id ORDER BY p.seleccionado DESC NULLS LAST, p.numero ASC LIMIT 1) AS proveedor_nombre,
                    COALESCE(SUM(CASE WHEN fc.pagado_financiera = true THEN fc.valor ELSE 0 END), 0)::numeric AS total_facturado,
                    COUNT(CASE WHEN fc.pagado_financiera = true THEN 1 END)::int AS facturas_aprobadas,
                    COUNT(fc.id)::int AS total_facturas,
                    MIN(fc.creado_en) FILTER (WHERE fc.aprobado_supervisor IS NULL AND fc.estado = 'pendiente') AS factura_pendiente_desde,
                    EXTRACT(DAY FROM NOW() - MIN(fc.creado_en) FILTER (WHERE fc.aprobado_supervisor IS NULL AND fc.estado = 'pendiente'))::int AS dias_accion_pendiente
             FROM solicitudes s
             JOIN usuarios u_sol ON s.solicitante_id = u_sol.id
             LEFT JOIN facturas_contrato fc ON fc.solicitud_id = s.id
             WHERE s.supervision_id = $1
               AND s.estado != 'borrador'
             GROUP BY s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.moneda, s.valor_en_cop, s.valor_estimado,
                      s.valor_moneda_cop_texto, s.valor_moneda_usd_texto, s.valor_moneda_eur_texto,
                      s.plazo_ejecucion_meses, s.plazo_ejecucion_dias, s.creado_en, u_sol.nombre
             ORDER BY dias_accion_pendiente DESC NULLS LAST, s.actualizado_en DESC`,
            [userId]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener contratos' });
    }
});

// Busca el proveedor ganador de un contrato: evaluación jurídica (fuente de verdad) con fallback a proponente seleccionado
async function obtenerProveedorContrato(solicitudId) {
    try {
        const evalJuriRes = await pool.query(
            `SELECT evaluacion_json->>'ganador_nombre' AS ganador_nombre,
                    evaluacion_json->>'ganador_email' AS ganador_email,
                    evaluacion_json->>'proponente_recomendado_numero' AS ganador_numero,
                    evaluacion_json->>'ganador_cedula_nit' AS ganador_cedula_nit
             FROM solicitudes_detalle_juridico WHERE solicitud_id = $1 LIMIT 1`,
            [solicitudId]
        );
        const evalJuri = evalJuriRes.rows[0];

        if (evalJuri?.ganador_nombre) {
            let propRes = await pool.query(
                `SELECT id, nombre_proveedor, datos_contacto, valor_con_impuestos, moneda
                 FROM proponentes WHERE solicitud_id = $1
                 AND LOWER(TRIM(nombre_proveedor)) = LOWER(TRIM($2)) LIMIT 1`,
                [solicitudId, evalJuri.ganador_nombre]
            );
            if (propRes.rows.length === 0 && evalJuri.ganador_numero != null) {
                propRes = await pool.query(
                    `SELECT id, nombre_proveedor, datos_contacto, valor_con_impuestos, moneda
                     FROM proponentes WHERE solicitud_id = $1 AND numero = $2 LIMIT 1`,
                    [solicitudId, Number(evalJuri.ganador_numero)]
                );
            }
            if (propRes.rows.length > 0) return propRes.rows[0];
            return {
                id: null,
                nombre_proveedor: evalJuri.ganador_nombre,
                datos_contacto: evalJuri.ganador_email || null,
                valor_con_impuestos: null,
                moneda: 'COP'
            };
        }

        const propRes = await pool.query(
            `SELECT id, nombre_proveedor, datos_contacto, valor_con_impuestos, moneda
             FROM proponentes WHERE solicitud_id = $1 ORDER BY seleccionado DESC NULLS LAST, numero ASC LIMIT 1`,
            [solicitudId]
        );
        return propRes.rows[0] || null;
    } catch (e) {
        console.error('Error buscando proveedor del contrato:', e.message);
        return null;
    }
}

// GET /api/supervisor/contratos/:id
// Detalle de contrato para supervisor (proveedor, valor, objeto, plazo)
app.get('/api/supervisor/contratos/:id', async (req, res) => {
    const { id } = req.params;
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });

    try {
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });

        const solRes = await pool.query(
            `SELECT s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.moneda, s.valor_en_cop, s.valor_estimado,
                    s.valor_moneda_cop_texto, s.valor_moneda_usd_texto, s.valor_moneda_eur_texto,
                    s.plazo_ejecucion_meses, s.plazo_ejecucion_dias, s.modalidad, s.creado_en,
                    s.supervision_aceptada, s.entregables, s.informes_supervision, s.numero_informes,
                    u_sol.nombre AS solicitante_nombre
             FROM solicitudes s
             JOIN usuarios u_sol ON s.solicitante_id = u_sol.id
             WHERE s.id = $1 AND s.supervision_id = $2`,
            [id, userRes.rows[0].id]
        );
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Contrato no encontrado' });

        // Buscar el proveedor ganador usando la evaluación jurídica como fuente de verdad
        const contrato = solRes.rows[0];
        contrato.proveedor = await obtenerProveedorContrato(id);

        // Evaluación existente
        try {
            const evalRes = await pool.query(
                `SELECT * FROM evaluaciones_proveedor WHERE solicitud_id = $1`,
                [id]
            );
            contrato.evaluacion = evalRes.rows[0] || null;
        } catch (e) {
            contrato.evaluacion = null;
        }

        return res.json(contrato);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener detalle' });
    }
});

// POST /api/supervisor/contratos/:id/aceptar
// El supervisor acepta o rechaza la supervisión y define entregables + documentos
app.post('/api/supervisor/contratos/:id/aceptar', async (req, res) => {
    const { id } = req.params;
    const { aceptada, entregables, informes_supervision, numero_informes } = req.body;
    if (typeof aceptada !== 'boolean') return res.status(400).json({ error: 'aceptada (boolean) requerido' });
    try {
        const entregablesTexto = typeof entregables === 'string' ? entregables : (entregables || null);
        await pool.query(
            `UPDATE solicitudes
             SET supervision_aceptada = $1, entregables = $2,
                 informes_supervision = $3, numero_informes = $4
             WHERE id = $5`,
            [aceptada, entregablesTexto, informes_supervision === true, informes_supervision ? (Number(numero_informes) || 0) : 0, id]
        );
        if (aceptada) {
            // Crear registros de entregables (uno por línea del texto)
            await pool.query('DELETE FROM entregables_supervisor WHERE solicitud_id = $1', [id]);
            if (entregablesTexto) {
                const items = entregablesTexto.split('\n').map(s => s.trim()).filter(Boolean);
                for (let i = 0; i < items.length; i++) {
                    await pool.query(
                        'INSERT INTO entregables_supervisor (solicitud_id, nombre, orden) VALUES ($1, $2, $3)',
                        [id, items[i], i]
                    );
                }
            }
            // Crear registros de informes de supervisión
            await pool.query('DELETE FROM informes_supervision_contrato WHERE solicitud_id = $1', [id]);
            const nInformes = informes_supervision ? (Number(numero_informes) || 0) : 0;
            for (let i = 1; i <= nInformes; i++) {
                await pool.query(
                    'INSERT INTO informes_supervision_contrato (solicitud_id, numero) VALUES ($1, $2)',
                    [id, i]
                );
            }
        }
        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar aceptación' });
    }
});

// GET /api/supervisor/contratos/:id/entregables-lista
app.get('/api/supervisor/contratos/:id/entregables-lista', async (req, res) => {
    const { id } = req.params;
    try {
        const r = await pool.query(
            'SELECT id, nombre, orden, completado, fecha_completado FROM entregables_supervisor WHERE solicitud_id = $1 ORDER BY orden ASC',
            [id]
        );
        return res.json(r.rows);
    } catch (err) { console.error(err); return res.status(500).json({ error: 'Error' }); }
});

// PATCH /api/supervisor/contratos/:id/entregables-lista/:itemId
app.patch('/api/supervisor/contratos/:id/entregables-lista/:itemId', async (req, res) => {
    const { id, itemId } = req.params;
    try {
        const r = await pool.query(
            `UPDATE entregables_supervisor
             SET completado = true,
                 fecha_completado = COALESCE(fecha_completado, NOW())
             WHERE id = $1 AND solicitud_id = $2
             RETURNING *`,
            [itemId, id]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
        return res.json(r.rows[0]);
    } catch (err) { console.error(err); return res.status(500).json({ error: 'Error' }); }
});

// GET /api/supervisor/contratos/:id/informes-lista
app.get('/api/supervisor/contratos/:id/informes-lista', async (req, res) => {
    const { id } = req.params;
    try {
        const r = await pool.query(
            'SELECT id, numero, completado, observaciones, fecha_completado FROM informes_supervision_contrato WHERE solicitud_id = $1 ORDER BY numero ASC',
            [id]
        );
        return res.json(r.rows);
    } catch (err) { console.error(err); return res.status(500).json({ error: 'Error' }); }
});

// PATCH /api/supervisor/contratos/:id/informes-lista/:itemId
app.patch('/api/supervisor/contratos/:id/informes-lista/:itemId', async (req, res) => {
    const { id, itemId } = req.params;
    const { observaciones } = req.body;
    try {
        const r = await pool.query(
            `UPDATE informes_supervision_contrato
             SET completado = true,
                 fecha_completado = COALESCE(fecha_completado, NOW()),
                 observaciones = COALESCE($3, observaciones)
             WHERE id = $1 AND solicitud_id = $2
             RETURNING *`,
            [itemId, id, observaciones ?? null]
        );
        if (!r.rows.length) return res.status(404).json({ error: 'No encontrado' });
        return res.json(r.rows[0]);
    } catch (err) { console.error(err); return res.status(500).json({ error: 'Error' }); }
});

// ─── Lista de documentos del supervisor por contrato ───────────────────────

// GET /api/supervisor/contratos/:id/documentos-lista
app.get('/api/supervisor/contratos/:id/documentos-lista', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `SELECT id, nombre, carpeta, completado, creado_en
             FROM documentos_supervisor
             WHERE solicitud_id = $1
             ORDER BY carpeta, creado_en ASC`,
            [id]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener lista de documentos' });
    }
});

// POST /api/supervisor/contratos/:id/documentos-lista
app.post('/api/supervisor/contratos/:id/documentos-lista', async (req, res) => {
    const { id } = req.params;
    const { nombre, carpeta } = req.body;
    if (!nombre || !carpeta) return res.status(400).json({ error: 'nombre y carpeta requeridos' });
    const carpetasValidas = ['01.Precontractual', '02.Contractual', '03.Postcontractual'];
    if (!carpetasValidas.includes(carpeta)) return res.status(400).json({ error: 'carpeta inválida' });
    try {
        const result = await pool.query(
            `INSERT INTO documentos_supervisor (solicitud_id, nombre, carpeta)
             VALUES ($1, $2, $3) RETURNING id, nombre, carpeta, creado_en`,
            [id, nombre.trim(), carpeta]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar documento' });
    }
});

// PATCH /api/supervisor/contratos/:id/documentos-lista/:docId — marcar completado/pendiente
app.patch('/api/supervisor/contratos/:id/documentos-lista/:docId', async (req, res) => {
    const { id, docId } = req.params;
    const { completado } = req.body;
    try {
        const result = await pool.query(
            `UPDATE documentos_supervisor SET completado = $1
             WHERE id = $2 AND solicitud_id = $3
             RETURNING id, nombre, carpeta, completado, creado_en`,
            [!!completado, docId, id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Documento no encontrado' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar documento' });
    }
});

// DELETE /api/supervisor/contratos/:id/documentos-lista/:docId
app.delete('/api/supervisor/contratos/:id/documentos-lista/:docId', async (req, res) => {
    const { id, docId } = req.params;
    try {
        await pool.query(
            `DELETE FROM documentos_supervisor WHERE id = $1 AND solicitud_id = $2`,
            [docId, id]
        );
        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al eliminar documento' });
    }
});

// POST /api/supervisor/evaluacion
// Guarda evaluación; si total < 70, bloquea proveedor
app.post('/api/supervisor/evaluacion', async (req, res) => {
    const { email, solicitud_id, nombre_proveedor, correo_proveedor, criterios, total,
        observaciones, firma_designado, fecha_evaluacion, proxima_evaluacion, proponente_id } = req.body;

    if (!email || !solicitud_id || !nombre_proveedor || total === undefined) {
        return res.status(400).json({ error: 'email, solicitud_id, nombre_proveedor y total son requeridos' });
    }

    try {
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        const evaluadorId = userRes.rows[0].id;

        // Verificar que el usuario es supervisor de esta solicitud
        const solRes = await pool.query(
            `SELECT id FROM solicitudes WHERE id = $1 AND supervision_id = $2`,
            [solicitud_id, evaluadorId]
        );
        if (solRes.rows.length === 0) return res.status(403).json({ error: 'No tiene permiso para evaluar este contrato' });

        const criteriosJson = JSON.stringify(Array.isArray(criterios) ? criterios : []);

        const evalRes = await pool.query(
            `INSERT INTO evaluaciones_proveedor 
             (solicitud_id, proponente_id, nombre_proveedor, correo_proveedor, evaluador_id, criterios, total,
              observaciones, firma_designado, fecha_evaluacion, proxima_evaluacion)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7, $8, $9, $10::date, nullif($11,'')::date)
             ON CONFLICT (solicitud_id) DO UPDATE SET
               proponente_id = EXCLUDED.proponente_id,
               nombre_proveedor = EXCLUDED.nombre_proveedor,
               correo_proveedor = EXCLUDED.correo_proveedor,
               criterios = EXCLUDED.criterios,
               total = EXCLUDED.total,
               observaciones = EXCLUDED.observaciones,
               firma_designado = EXCLUDED.firma_designado,
               fecha_evaluacion = EXCLUDED.fecha_evaluacion,
               proxima_evaluacion = EXCLUDED.proxima_evaluacion
             RETURNING id`,
            [solicitud_id, proponente_id || null, nombre_proveedor, correo_proveedor || null,
                evaluadorId, criteriosJson, Number(total), observaciones || null, firma_designado || null,
                fecha_evaluacion || new Date().toISOString().slice(0, 10), proxima_evaluacion || null]
        );

        const evalId = evalRes.rows[0].id;
        let bloqueado = false;

        if (Number(total) < 70) {
            const identificador = String(nombre_proveedor || '').trim().toUpperCase().replace(/\s+/g, ' ');
            if (identificador) {
                await pool.query(
                    `INSERT INTO proveedores_bloqueados (identificador, nombre_original, motivo, evaluacion_id)
                     VALUES ($1, $2, 'Evaluación inferior a 70 puntos', $3)
                     ON CONFLICT (identificador) DO UPDATE SET evaluacion_id = EXCLUDED.evaluacion_id, motivo = EXCLUDED.motivo`,
                    [identificador, nombre_proveedor, evalId]
                );
                bloqueado = true;
            }
        }

        return res.json({ success: true, evaluacion_id: evalId, bloqueado });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar evaluación' });
    }
});

// ─── RUTAS PARA SUPERVISOR: Calificación concurrente de proponentes ──
// Estados en los que Jurídica está activamente calificando y el supervisor
// designado también debe poder calificar en paralelo.
const ESTADOS_CALIFICACION_SUPERVISOR = ['en_juridica', 'enviado_juridica'];
// Solo Invitación y TDR comparan proponentes (igual que esModalidadCalificable en el frontend de Jurídica).
const MODALIDADES_CALIFICABLES_SUPERVISOR = ['invitacion', 'tdr'];

// GET /api/supervisor/solicitudes-en-calificacion?email=xxx
// Lista las solicitudes donde el usuario es el supervisor designado (supervision_id)
// y la solicitud está en etapa de calificación de proponentes.
app.get('/api/supervisor/solicitudes-en-calificacion', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });
    try {
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.json([]);

        const result = await pool.query(
            `SELECT s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.modalidad,
                    dj.evaluacion_json->'supervisor'->>'finalizada' AS supervisor_finalizada
             FROM solicitudes s
             LEFT JOIN solicitudes_detalle_juridico dj ON dj.solicitud_id = s.id
             WHERE s.supervision_id = $1
               AND s.estado::text = ANY($2::text[])
               AND LOWER(s.modalidad::text) = ANY($3::text[])
             ORDER BY s.actualizado_en DESC`,
            [userRes.rows[0].id, ESTADOS_CALIFICACION_SUPERVISOR, MODALIDADES_CALIFICABLES_SUPERVISOR]
        );
        const lista = result.rows.map(r => ({
            ...r,
            supervisor_finalizada: r.supervisor_finalizada === 'true'
        }));
        return res.json(lista);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener solicitudes en calificación' });
    }
});

// GET /api/supervisor/solicitudes/:id/calificacion?email=xxx
// Mismo detalle que ve Jurídica, pero solo accesible por el supervisor designado
// de esa solicitud, y solo mientras está en etapa de calificación.
app.get('/api/supervisor/solicitudes/:id/calificacion', async (req, res) => {
    const { id } = req.params;
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });
    try {
        const check = await pool.query(
            `SELECT s.estado, s.modalidad FROM solicitudes s
             JOIN usuarios u ON u.id = s.supervision_id
             WHERE s.id = $1::uuid AND u.email = $2`,
            [id, email]
        );
        if (check.rows.length === 0) {
            return res.status(403).json({ error: 'No está designado como supervisor de esta solicitud' });
        }
        if (!ESTADOS_CALIFICACION_SUPERVISOR.includes(check.rows[0].estado)) {
            return res.status(409).json({ error: 'Esta solicitud no está en etapa de calificación de proponentes' });
        }
        if (!MODALIDADES_CALIFICABLES_SUPERVISOR.includes(String(check.rows[0].modalidad || '').toLowerCase())) {
            return res.status(409).json({ error: 'Esta modalidad no requiere calificación de proponentes' });
        }

        const result = await construirDetalleCalificacion(id);
        if (result.error) return res.status(result.status || 500).json({ error: result.error });
        return res.json(result.data);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener calificación del supervisor' });
    }
});

// PUT /api/supervisor/solicitudes/:id/calificacion
// Guarda la calificación propia del supervisor, de forma independiente a la de Jurídica,
// dentro de evaluacion_json.supervisor (no toca las calificaciones de Jurídica).
app.put('/api/supervisor/solicitudes/:id/calificacion', async (req, res) => {
    const { id } = req.params;
    const {
        email = null,
        calificaciones = [],
        config_puntajes = null,
        evaluacion_consolidada = '',
        proponente_recomendado_numero = null,
        habilitantes_revisados = [],
        finalizada = false
    } = req.body || {};

    if (!email) return res.status(400).json({ error: 'email requerido' });

    const numeroRecomendadoRaw = proponente_recomendado_numero != null ? Number(proponente_recomendado_numero) : null;
    const numeroRecomendado = Number.isFinite(numeroRecomendadoRaw) && numeroRecomendadoRaw > 0
        ? Math.trunc(numeroRecomendadoRaw)
        : null;

    const client = await pool.connect();
    try {
        await ensureJuridicaDetailStorage();
        await client.query('BEGIN');

        const check = await client.query(
            `SELECT s.estado, s.modalidad, u.id as usuario_id FROM solicitudes s
             JOIN usuarios u ON u.id = s.supervision_id
             WHERE s.id = $1::uuid AND u.email = $2`,
            [id, email]
        );
        if (check.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'No está designado como supervisor de esta solicitud' });
        }
        if (!ESTADOS_CALIFICACION_SUPERVISOR.includes(check.rows[0].estado)) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Esta solicitud no está en etapa de calificación de proponentes' });
        }
        if (!MODALIDADES_CALIFICABLES_SUPERVISOR.includes(String(check.rows[0].modalidad || '').toLowerCase())) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Esta modalidad no requiere calificación de proponentes' });
        }
        const userId = check.rows[0].usuario_id;

        const prevEvRes = await client.query(
            `SELECT evaluacion_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`,
            [id]
        );
        const prevEv = prevEvRes.rows[0]?.evaluacion_json || {};

        if (prevEv.supervisor?.finalizada === true) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'La calificación del supervisor ya fue finalizada y no puede modificarse.' });
        }

        const supervisorEval = {
            calificaciones: Array.isArray(calificaciones) ? calificaciones.map((c) => ({
                numero: Number.isFinite(Number(c?.numero)) ? Number(c.numero) : null,
                propuesta_economica: Number(c?.propuesta_economica || 0),
                experiencia_adicional: Number(c?.experiencia_adicional || 0),
                experiencia_trabajo: Number(c?.experiencia_trabajo || 0),
                otros_criterios_puntos: Number(c?.otros_criterios_puntos || 0),
                puntajes: (c?.puntajes && typeof c.puntajes === 'object') ? c.puntajes : {},
                habilitante_detalle: c?.habilitante_detalle || null,
                total: Number(c?.total || 0)
            })) : [],
            config_puntajes: config_puntajes || null,
            evaluacion_consolidada: String(evaluacion_consolidada || ''),
            proponente_recomendado_numero: numeroRecomendado,
            habilitantes_revisados: Array.isArray(habilitantes_revisados) ? habilitantes_revisados.map(Number) : [],
            finalizada: finalizada === true ? true : (prevEv.supervisor?.finalizada || false),
            finalizada_en: finalizada === true ? new Date().toISOString() : (prevEv.supervisor?.finalizada_en || null),
            email,
            actualizado_en: new Date().toISOString()
        };

        const evaluacion = { ...prevEv, supervisor: supervisorEval };

        await client.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, evaluacion_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET evaluacion_json = EXCLUDED.evaluacion_json, actualizado_en = NOW()`,
            [id, JSON.stringify(evaluacion)]
        );

        await client.query('COMMIT');

        await registrarLog({
            tipo_log: 'negocio', modulo: 'supervisor', tabla: 'solicitudes',
            registro_id: id,
            accion: finalizada === true ? 'CALIFICACION_SUPERVISOR_FINALIZADA' : 'CALIFICACION_SUPERVISOR_GUARDADA',
            descripcion: finalizada === true
                ? 'Calificación del supervisor FINALIZADA (documento bloqueado)'
                : 'Calificación del supervisor guardada',
            usuario_id: userId || null
        });

        return res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar calificación del supervisor', detalle: err?.message || null });
    } finally {
        client.release();
    }
});

// GET /api/proveedores/bloqueados?nombre=xxx
app.get('/api/proveedores/bloqueados', async (req, res) => {
    const { nombre } = req.query;
    if (!nombre) return res.json({ bloqueado: false });

    try {
        const ident = String(nombre).trim().toUpperCase().replace(/\s+/g, ' ');
        const r = await pool.query(
            `SELECT 1 FROM proveedores_bloqueados WHERE identificador = $1`,
            [ident]
        );
        return res.json({ bloqueado: r.rows.length > 0 });
    } catch (err) {
        return res.json({ bloqueado: false });
    }
});

// ─── RUTA: Enviar solicitud al gerente ────────────────────────
// PUT /api/solicitudes/:id/enviar
app.put('/api/solicitudes/:id/enviar', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await pool.query(
            `UPDATE solicitudes
             SET estado = 'enviado_gerente',
                 fecha_envio_gerente = NOW(),
                 actualizado_en = NOW()
             WHERE id = $1
               AND estado IN ('borrador', 'rechazado_gerente', 'devuelto_al_solicitante', 'rechazado_financiera', 'rechazado_juridica', 'rechazado_comite', 'rechazado_riesgos')
             RETURNING id, codigo, estado, solicitante_id`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(400).json({ error: 'La solicitud no está en un estado que permita reenvío al gerente.' });
        }
        const solEnv = result.rows[0];
        await registrarLog({
            tipo_log: 'negocio', modulo: 'solicitudes', tabla: 'solicitudes',
            registro_id: solEnv.id, accion: 'UPDATE',
            campo: 'estado', valor_anterior: 'borrador', valor_nuevo: 'enviado_gerente',
            descripcion: `Solicitante envió la solicitud ${solEnv.codigo} al gerente para aprobación`,
            usuario_id: req.auth?.usuarioId || solEnv.solicitante_id, rol_usuario: req.auth?.rol || 'supervisor',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });
        return res.json({ success: true, message: 'Solicitud enviada al Gerente de Área', solicitud: solEnv });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al enviar solicitud' });
    }
});

// ─── RUTA: Aprobar/Rechazar como Gerente y enviar a Financiera ─
// POST /api/solicitudes/:id/aprobar-gerente
app.post('/api/solicitudes/:id/aprobar-gerente', async (req, res) => {
    const { id } = req.params;
    const { aprobar, comentario, gerente_id } = req.body;

    if (aprobar === undefined) return res.status(400).json({ error: 'aprobar es requerido' });

    try {
        // Si aprueba: pasa a Financiera.
        // Si rechaza: se marca como rechazado por el gerente (vuelve al solicitante).
        const nuevoEstado = aprobar ? 'en_financiera' : 'rechazado_gerente';

        const result = await pool.query(
            `UPDATE solicitudes 
             SET estado = $1::estado_solicitud,
                 comentario_gerente = COALESCE($2, comentario_gerente),
                 gerente_id = COALESCE($3, gerente_id),
                 fecha_respuesta_gerente = NOW(),
                 fecha_envio_financiera = CASE WHEN $1::text = 'en_financiera' THEN NOW() ELSE fecha_envio_financiera END,
                 actualizado_en = NOW()
             WHERE id = $4 AND estado = 'enviado_gerente'
             RETURNING id, codigo, estado`,
            [nuevoEstado, comentario, gerente_id, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada o ya fue procesada' });
        }

        const sol = result.rows[0];
        await registrarLog({
            tipo_log: 'negocio', modulo: 'solicitudes', tabla: 'solicitudes',
            registro_id: sol.id, accion: aprobar ? 'APROBACION' : 'RECHAZO',
            campo: 'estado', valor_anterior: 'enviado_gerente', valor_nuevo: sol.estado,
            descripcion: `Gerente ${aprobar ? 'aprobó' : 'rechazó'} la solicitud ${sol.codigo}${comentario ? ': ' + comentario : ''}`,
            usuario_id: gerente_id || null, rol_usuario: 'gerente',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json(sol);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al procesar aprobación' });
    }
});

// ─── RUTA: Aprobar/Rechazar como Financiera y devolver al solicitante ─
// POST /api/solicitudes/:id/aprobar-financiera
app.post('/api/solicitudes/:id/aprobar-financiera', async (req, res) => {
    const { id } = req.params;
    const { aprobar, comentario, rubro, presupuesto_aprobado, financiera_id } = req.body;

    if (aprobar === undefined) return res.status(400).json({ error: 'aprobar es requerido' });

    try {
        // Directa, TDR e Invitación pasan primero por Jurídica solo para el concepto
        // jurídico (7.1-7.3), y de ahí a Riesgos/Comité antes de que Jurídica retome
        // el resto del proceso.
        const result = await pool.query(
            `UPDATE solicitudes
             SET estado = CASE
                     WHEN $1::boolean = true THEN 'en_juridica_concepto'::estado_solicitud
                     ELSE 'rechazado_financiera'::estado_solicitud
                 END,
                 comentario_financiera = COALESCE($2, comentario_financiera),
                 financiera_id = COALESCE($3::uuid, financiera_id),
                 rubro = COALESCE($4, rubro),
                 presupuesto_aprobado = COALESCE($5, presupuesto_aprobado),
                 fecha_respuesta_financiera = NOW(),
                 actualizado_en = NOW()
             WHERE id = $6 AND estado = 'en_financiera'
             RETURNING id, codigo, estado, modalidad`,
            [aprobar, comentario, financiera_id, rubro, presupuesto_aprobado, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada o ya fue procesada' });
        }

        const solFin = result.rows[0];

        // Verificar que el usuario existe en la BD antes de registrar el log
        let usuarioIdLog = null;
        if (financiera_id) {
            const uCheck = await pool.query('SELECT id FROM usuarios WHERE id = $1', [financiera_id]);
            if (uCheck.rows.length > 0) usuarioIdLog = financiera_id;
        }

        try {
            await registrarLog({
                tipo_log: 'negocio', modulo: 'solicitudes', tabla: 'solicitudes',
                registro_id: solFin.id, accion: aprobar ? 'APROBACION' : 'RECHAZO',
                campo: 'estado', valor_anterior: 'en_financiera', valor_nuevo: solFin.estado,
                descripcion: `Financiera ${aprobar ? 'aprobó' : 'rechazó'} la solicitud ${solFin.codigo}${rubro ? ' | Rubro: ' + rubro : ''}${comentario ? ' | ' + comentario : ''}`,
                usuario_id: usuarioIdLog, rol_usuario: 'financiera',
                ip_address: getClientIp(req), resultado: 'exitoso'
            });
        } catch (logErr) {
            console.error('Audit log no crítico (aprobación financiera):', logErr.message);
        }

        return res.json(solFin);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al procesar aprobación financiera' });
    }
});

// ─── RUTA: Bandeja de solicitudes para Secretaría de Comité ────────
// GET /api/secretaria/comite
// Devuelve las solicitudes ya aprobadas por financiera que deben ir a comité.
app.get('/api/secretaria/comite', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM v_solicitudes_resumen
             WHERE estado = 'en_comite'
             ORDER BY actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener solicitudes para comité' });
    }
});

// ─── RUTA: Métricas para Secretaría de Comité ──────────────────────
// GET /api/secretaria/metrics
app.get('/api/secretaria/metrics', async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE estado = 'en_comite' AND resultado_comite IS NULL) AS pendientes,
                COUNT(*) FILTER (WHERE resultado_comite = 'aprobado') AS aprobadas,
                COUNT(*) FILTER (WHERE resultado_comite = 'rechazado') AS rechazadas
            FROM solicitudes
        `);
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener métricas de secretaría' });
    }
});

// ─── RUTA: Historial de actas de comité ──────────────────────────
// GET /api/secretaria/actas/historial
// Devuelve actas formales guardadas + sesiones reconstruidas desde solicitudes.
app.get('/api/secretaria/actas/historial', async (_req, res) => {
    try {
        // 1. Actas formales (tabla actas_comite si existe)
        let actasFormales = [];
        try {
            const r = await pool.query(
                `SELECT id::text, acta_numero, fecha_sesion, participantes, solicitudes_ids, decisiones, creado_en,
                        desarrollo_texto, conclusion_texto, desarrollo_cerrado, conclusion_cerrada,
                        firmante_directora_nombre, firmante_directora_cargo,
                        firmante_secretaria_nombre, firmante_secretaria_cargo,
                        cerrada_en, firma_id
                 FROM actas_comite ORDER BY fecha_sesion DESC`
            );
            actasFormales = r.rows.map(a => ({
                source: 'formal',
                actaId: a.id,
                ids: a.solicitudes_ids || [],
                actaNumero: a.acta_numero || '',
                fechaSesionISO: a.fecha_sesion,
                participantes: a.participantes || [],
                decisiones: a.decisiones || {},
                savedAt: a.creado_en,
                desarrolloTexto: a.desarrollo_texto || '',
                conclusionTexto: a.conclusion_texto || '',
                desarrolloCerrado: a.desarrollo_cerrado || false,
                conclusionCerrada: a.conclusion_cerrada || false,
                firmanteDirectoraNombre: a.firmante_directora_nombre || '',
                firmanteDirectoraCargo: a.firmante_directora_cargo || '',
                firmanteSecretariaNombre: a.firmante_secretaria_nombre || '',
                firmanteSecretariaCargo: a.firmante_secretaria_cargo || '',
                cerradaEn: a.cerrada_en || null,
                firmaId: a.firma_id || null,
            }));
        } catch (_e) { /* tabla aún no creada */ }

        const idsCubiertos = new Set(actasFormales.flatMap(a => a.ids));

        // 2. Solicitudes históricas que ya pasaron por comité
        const q = await pool.query(
            `SELECT s.id::text, s.resultado_comite, s.comentario_comite, s.fecha_comite_decision
             FROM solicitudes s
             WHERE s.resultado_comite IS NOT NULL
             ORDER BY s.fecha_comite_decision DESC`
        );

        // Agrupar por fecha (cada día = sesión reconstruida)
        const porFecha = {};
        for (const row of q.rows) {
            if (idsCubiertos.has(row.id)) continue;
            const dateKey = row.fecha_comite_decision
                ? new Date(row.fecha_comite_decision).toISOString().split('T')[0]
                : 'sin_fecha';
            if (!porFecha[dateKey]) {
                porFecha[dateKey] = {
                    source: 'reconstruida',
                    ids: [],
                    actaNumero: null,
                    fechaSesionISO: row.fecha_comite_decision || new Date().toISOString(),
                    participantes: [],
                    decisiones: {},
                    savedAt: row.fecha_comite_decision || new Date().toISOString(),
                };
            }
            const decision = row.resultado_comite === 'aprobado' ? 'aprobada'
                : row.resultado_comite === 'rechazado' ? 'rechazada'
                    : 'en_revision';
            porFecha[dateKey].ids.push(row.id);
            porFecha[dateKey].decisiones[row.id] = {
                discusion: row.comentario_comite || '',
                decision,
            };
        }

        const todo = [...actasFormales, ...Object.values(porFecha)].sort(
            (a, b) => new Date(b.fechaSesionISO).getTime() - new Date(a.fechaSesionISO).getTime()
        );
        return res.json(todo);
    } catch (err) {
        console.error('Error historial actas:', err);
        return res.status(500).json({ error: 'Error al obtener historial de actas' });
    }
});

// ─── RUTA: Guardar acta de comité ────────────────────────────────
// POST /api/secretaria/actas
app.post('/api/secretaria/actas', async (req, res) => {
    try {
        const { acta_numero, fecha_sesion, participantes, solicitudes_ids, decisiones } = req.body;
        const result = await pool.query(
            `INSERT INTO actas_comite (acta_numero, fecha_sesion, participantes, solicitudes_ids, decisiones)
             VALUES ($1, $2, $3::jsonb, $4, $5::jsonb)
             RETURNING id::text`,
            [
                acta_numero || null,
                fecha_sesion || new Date().toISOString(),
                JSON.stringify(participantes || []),
                solicitudes_ids || [],
                JSON.stringify(decisiones || {}),
            ]
        );
        return res.json({ ok: true, id: result.rows[0].id });
    } catch (err) {
        console.error('Error guardando acta:', err);
        return res.status(500).json({ error: 'Error al guardar acta' });
    }
});

// PATCH /api/secretaria/actas/:id/textos
// Guarda desarrollo y/o conclusión del acta y los cierra (no editables después).
app.patch('/api/secretaria/actas/:id/textos', async (req, res) => {
    const { id } = req.params;
    const { desarrollo_texto, conclusion_texto, cerrar_desarrollo, cerrar_conclusion } = req.body;
    try {
        const sets = [];
        const vals = [];
        let i = 1;
        if (desarrollo_texto !== undefined) { sets.push(`desarrollo_texto = $${i++}`); vals.push(desarrollo_texto); }
        if (cerrar_desarrollo) { sets.push(`desarrollo_cerrado = TRUE`); }
        if (conclusion_texto !== undefined) { sets.push(`conclusion_texto = $${i++}`); vals.push(conclusion_texto); }
        if (cerrar_conclusion) { sets.push(`conclusion_cerrada = TRUE`); }
        if (sets.length === 0) return res.json({ ok: true });
        vals.push(id);
        await pool.query(
            `UPDATE actas_comite SET ${sets.join(', ')} WHERE id = $${i}::uuid`,
            vals
        );
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error actualizando textos acta:', err);
        return res.status(500).json({ error: 'Error al actualizar acta' });
    }
});

// PATCH /api/secretaria/actas/:id/firmantes
// Permite fijar, para esta acta puntual, quién firma como Directora y Secretaria
// del Comité (pueden variar de una sesión a otra en vez de usar siempre el
// valor único configurado en configuracion_firmantes).
app.patch('/api/secretaria/actas/:id/firmantes', async (req, res) => {
    const { id } = req.params;
    const {
        firmante_directora_nombre, firmante_directora_cargo,
        firmante_secretaria_nombre, firmante_secretaria_cargo,
    } = req.body;
    try {
        const sets = [];
        const vals = [];
        let i = 1;
        if (firmante_directora_nombre !== undefined) { sets.push(`firmante_directora_nombre = $${i++}`); vals.push(firmante_directora_nombre); }
        if (firmante_directora_cargo !== undefined) { sets.push(`firmante_directora_cargo = $${i++}`); vals.push(firmante_directora_cargo); }
        if (firmante_secretaria_nombre !== undefined) { sets.push(`firmante_secretaria_nombre = $${i++}`); vals.push(firmante_secretaria_nombre); }
        if (firmante_secretaria_cargo !== undefined) { sets.push(`firmante_secretaria_cargo = $${i++}`); vals.push(firmante_secretaria_cargo); }
        if (sets.length === 0) return res.json({ ok: true });
        vals.push(id);
        await pool.query(
            `UPDATE actas_comite SET ${sets.join(', ')} WHERE id = $${i}::uuid`,
            vals
        );
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error actualizando firmantes del acta:', err);
        return res.status(500).json({ error: 'Error al actualizar firmantes del acta' });
    }
});

// ─── RUTA: Registrar resultado del Comité para una solicitud ───────
// POST /api/solicitudes/:id/comite
app.post('/api/solicitudes/:id/comite', async (req, res) => {
    const { id } = req.params;
    const { resultado, comentario, usuario_email } = req.body;

    if (!resultado || !['aprobado', 'rechazado', 'en_revision'].includes(resultado)) {
        return res.status(400).json({ error: 'resultado debe ser "aprobado", "rechazado" o "en_revision"' });
    }

    if (resultado === 'en_revision' && !String(comentario || '').trim()) {
        return res.status(400).json({ error: 'comentario es obligatorio para devolver la solicitud' });
    }

    try {
        // Si queda en revisión, se devuelve al solicitante para corrección y reinicio del flujo.
        const nuevoEstado =
            resultado === 'aprobado'
                ? 'en_juridica'
                : resultado === 'rechazado'
                    ? 'rechazado_comite'
                    : 'borrador';

        const result = await pool.query(
            `UPDATE solicitudes
             SET resultado_comite = $1::text,
                 estado = $4::estado_solicitud,
                 comentario_comite = COALESCE($2::text, comentario_comite),
                 fecha_comite_decision = NOW(),
                 fecha_comite = CASE WHEN $1::text = 'aprobado' THEN NOW() ELSE fecha_comite END,
                 actualizado_en = NOW()
             WHERE id = $3::uuid
             RETURNING id, codigo, estado, resultado_comite, fecha_comite_decision`,
            [resultado, comentario || null, id, nuevoEstado]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        const solComite = result.rows[0];
        const accionComite = resultado === 'aprobado' ? 'APROBACION' : resultado === 'rechazado' ? 'RECHAZO' : 'DEVOLUCION';
        const uComite = await usuarioPorEmail(usuario_email);
        await registrarLog({
            tipo_log: 'negocio', modulo: 'solicitudes', tabla: 'solicitudes',
            registro_id: solComite.id, accion: accionComite,
            campo: 'resultado_comite', valor_anterior: null, valor_nuevo: resultado,
            descripcion: `Comité ${resultado === 'aprobado' ? 'aprobó' : resultado === 'rechazado' ? 'rechazó' : 'devolvió a revisión'} la solicitud ${solComite.codigo}${comentario ? ': ' + comentario : ''}`,
            usuario_id: uComite?.id || null, rol_usuario: uComite?.rol || 'secretaria_comite',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json(solComite);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar resultado del comité' });
    }
});

// POST /api/solicitudes/:id/juridica
app.post('/api/solicitudes/:id/juridica', async (req, res) => {
    const { id } = req.params;
    const { resultado, comentario, usuario_email } = req.body;

    if (!resultado || !['aprobado', 'rechazado'].includes(resultado)) {
        return res.status(400).json({ error: 'resultado debe ser "aprobado" o "rechazado"' });
    }

    try {
        await ensureJuridicaDetailStorage();

        if (resultado === 'aprobado') {
            const checklistRes = await pool.query(
                `SELECT s.modalidad,
                        d.evaluacion_json,
                        d.documentos_json,
                        d.repositorio_sharepoint_creado
                 FROM solicitudes s
                 LEFT JOIN solicitudes_detalle_juridico d ON d.solicitud_id = s.id
                 WHERE s.id = $1::uuid`,
                [id]
            );

            if (checklistRes.rows.length === 0) {
                return res.status(404).json({ error: 'Solicitud no encontrada' });
            }

            const row = checklistRes.rows[0];
            const modalidad = String(row.modalidad || '').toLowerCase();

            if (requiereFlujoSecuencialJuridica(modalidad)) {
                const estadoFlujo = await obtenerEstadoFlujoJuridica(id);
                const orden = ordenFlujoParaModalidad(modalidad);
                if (!orden.every((p) => pasoFlujoCompletado(p, estadoFlujo))) {
                    return res.status(400).json({ error: mensajeFlujoIncompleto(estadoFlujo, orden) });
                }
            }
        }

        const nuevoEstado = resultado === 'aprobado' ? 'aprobado_juridica' : 'rechazado_juridica';

        const result = await pool.query(
            `UPDATE solicitudes
             SET resultado_juridica = $1::text,
                 comentario_juridica = COALESCE($2::text, comentario_juridica),
                 estado = $4::estado_solicitud,
                 fecha_respuesta_juridica = NOW(),
                 fecha_inicio_contrato = CASE
                     WHEN $4::estado_solicitud = 'aprobado_juridica' THEN COALESCE(fecha_inicio_contrato, NOW()::date)
                     ELSE fecha_inicio_contrato
                 END,
                 actualizado_en = NOW()
             WHERE id = $3::uuid
             RETURNING id, codigo, estado, resultado_juridica`,
            [resultado, comentario || null, id, nuevoEstado]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        const solJur = result.rows[0];
        const uJur = await usuarioPorEmail(usuario_email);
        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: solJur.id, accion: resultado === 'aprobado' ? 'APROBACION' : 'RECHAZO',
            campo: 'resultado_juridica', valor_anterior: null, valor_nuevo: resultado,
            descripcion: `Jurídica ${resultado === 'aprobado' ? 'aprobó legalmente' : 'rechazó legalmente'} la solicitud ${solJur.codigo}${comentario ? ': ' + comentario : ''}`,
            usuario_id: uJur?.id || null, rol_usuario: uJur?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json(solJur);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar resultado de jurídica' });
    }
});

// ─── RUTA: Guardar Concepto Jurídico y Garantías (Jurídica) ──
// PUT /api/solicitudes/:id/concepto-juridico
app.put('/api/solicitudes/:id/concepto-juridico', async (req, res) => {
    const { id } = req.params;
    const { concepto_juridico, garantias, tiene_riesgos_juridicos, riesgos_juridicos, usuario_email } = req.body;

    try {
        const tieneRiesgos = tiene_riesgos_juridicos === true || tiene_riesgos_juridicos === 'si';

        const result = await pool.query(
            `UPDATE solicitudes
             SET concepto_juridico = $1,
                 garantias = $2,
                 tiene_riesgos_juridicos = $3,
                 riesgos_juridicos = CASE WHEN $3 THEN $4 ELSE NULL END,
                 actualizado_en = NOW()
             WHERE id = $5::uuid
             RETURNING id, codigo, concepto_juridico, garantias, tiene_riesgos_juridicos, riesgos_juridicos`,
            [concepto_juridico || null, garantias || null, tieneRiesgos, riesgos_juridicos || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        const solActualizada = result.rows[0];
        const uJur = await usuarioPorEmail(usuario_email);
        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: solActualizada.id, accion: 'ACTUALIZACION',
            campo: 'concepto_juridico', valor_anterior: null, valor_nuevo: concepto_juridico || null,
            descripcion: `Jurídica registró el concepto jurídico y garantías de la solicitud ${solActualizada.codigo}`,
            usuario_id: uJur?.id || null, rol_usuario: uJur?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json(solActualizada);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar el concepto jurídico: ' + (err.message || err.toString()) });
    }
});

// ─── RUTA: Enviar Concepto Jurídico → Riesgos o Comité ──
// POST /api/solicitudes/:id/enviar-concepto-juridico
// Cierra la primera visita de Jurídica (solo 7.1 Concepto jurídico, 7.2 Garantías,
// 7.3 ¿Tiene riesgos jurídicos?) y deriva a Riesgos (si aplica) o directo a Comité.
// Invitación no pasa por Comité: si no tiene riesgos jurídicos, o una vez Riesgos
// la resuelve, vuelve directo a Jurídica para la segunda visita.
app.post('/api/solicitudes/:id/enviar-concepto-juridico', async (req, res) => {
    const { id } = req.params;
    const { usuario_email } = req.body;

    try {
        const actual = await pool.query(
            `SELECT id, codigo, estado, concepto_juridico, garantias, tiene_riesgos_juridicos, modalidad
             FROM solicitudes WHERE id = $1::uuid`,
            [id]
        );
        if (actual.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }
        const sol = actual.rows[0];
        if (sol.estado !== 'en_juridica_concepto') {
            return res.status(400).json({ error: 'La solicitud no está en la fase de concepto jurídico.' });
        }
        if (!String(sol.concepto_juridico || '').trim() || !String(sol.garantias || '').trim() || sol.tiene_riesgos_juridicos === null) {
            return res.status(400).json({ error: 'Diligencie el concepto jurídico, las garantías y si tiene riesgos jurídicos antes de enviar.' });
        }

        const esInvitacion = String(sol.modalidad || '').toLowerCase().startsWith('invitaci');
        const nuevoEstado = sol.tiene_riesgos_juridicos
            ? 'en_riesgos'
            : (esInvitacion ? 'en_juridica' : 'en_comite');

        const result = await pool.query(
            `UPDATE solicitudes
             SET estado = $1::estado_solicitud,
                 fecha_envio_juridica = NOW(),
                 actualizado_en = NOW()
             WHERE id = $2::uuid AND estado = 'en_juridica_concepto'
             RETURNING id, codigo, estado`,
            [nuevoEstado, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada o ya fue procesada' });
        }

        const solEnviada = result.rows[0];
        const uJur = await usuarioPorEmail(usuario_email);
        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: solEnviada.id, accion: 'ACTUALIZACION',
            campo: 'estado', valor_anterior: 'en_juridica_concepto', valor_nuevo: solEnviada.estado,
            descripcion: `Jurídica envió el concepto jurídico de la solicitud ${solEnviada.codigo}${nuevoEstado === 'en_riesgos' ? ' → derivada a Riesgos' : nuevoEstado === 'en_comite' ? ' → derivada a Comité' : ' → retoma Jurídica'}`,
            usuario_id: uJur?.id || null, rol_usuario: uJur?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json(solEnviada);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al enviar el concepto jurídico' });
    }
});

// ─── RUTAS PARA EL ROL RIESGOS ────────────────────────────────
// GET /api/riesgos/solicitudes
app.get('/api/riesgos/solicitudes', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM v_solicitudes_resumen
             WHERE estado = 'en_riesgos'
             ORDER BY actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener solicitudes para riesgos' });
    }
});

// GET /api/riesgos/metrics
app.get('/api/riesgos/metrics', async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                COUNT(*) FILTER (WHERE estado = 'en_riesgos') AS pendientes,
                COUNT(*) FILTER (WHERE resultado_riesgos = 'aprobado') AS aprobadas,
                COUNT(*) FILTER (WHERE resultado_riesgos = 'rechazado') AS rechazadas
            FROM solicitudes
        `);
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener métricas de riesgos' });
    }
});

// ─── RUTA: Registrar resultado de Riesgos para una solicitud ───────
// POST /api/solicitudes/:id/riesgos
app.post('/api/solicitudes/:id/riesgos', async (req, res) => {
    const { id } = req.params;
    const { resultado, comentario, usuario_email } = req.body;

    if (!resultado || !['aprobado', 'rechazado'].includes(resultado)) {
        return res.status(400).json({ error: 'resultado debe ser "aprobado" o "rechazado"' });
    }

    try {
        const uRiesgos = await usuarioPorEmail(usuario_email);

        // Invitación no pasa por Comité: al aprobar Riesgos, vuelve directo a Jurídica.
        const result = await pool.query(
            `UPDATE solicitudes
             SET resultado_riesgos = $1::text,
                 comentario_riesgos = COALESCE($2::text, comentario_riesgos),
                 riesgos_id = COALESCE($3::uuid, riesgos_id),
                 estado = CASE
                     WHEN $1::text = 'rechazado' THEN 'rechazado_riesgos'::estado_solicitud
                     WHEN LOWER(modalidad::text) LIKE 'invitaci%' THEN 'en_juridica'::estado_solicitud
                     ELSE 'en_comite'::estado_solicitud
                 END,
                 fecha_respuesta_riesgos = NOW(),
                 actualizado_en = NOW()
             WHERE id = $4::uuid AND estado = 'en_riesgos'
             RETURNING id, codigo, estado, resultado_riesgos`,
            [resultado, comentario || null, uRiesgos?.id || null, id]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Solicitud no encontrada o ya fue procesada' });
        }

        const solRiesgos = result.rows[0];
        await registrarLog({
            tipo_log: 'negocio', modulo: 'solicitudes', tabla: 'solicitudes',
            registro_id: solRiesgos.id, accion: resultado === 'aprobado' ? 'APROBACION' : 'RECHAZO',
            campo: 'resultado_riesgos', valor_anterior: null, valor_nuevo: resultado,
            descripcion: `Riesgos ${resultado === 'aprobado' ? 'aprobó' : 'rechazó'} la solicitud ${solRiesgos.codigo}${comentario ? ': ' + comentario : ''}`,
            usuario_id: uRiesgos?.id || null, rol_usuario: uRiesgos?.rol || 'riesgos',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json(solRiesgos);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar resultado de riesgos' });
    }
});

// POST /api/sharepoint/crear-repositorio
// Crea la estructura de carpetas en SharePoint sitio Documental y marca en BD
app.post('/api/sharepoint/crear-repositorio', async (req, res) => {
    const { solicitudId } = req.body;
    if (!solicitudId) return res.status(400).json({ error: 'solicitudId es requerido' });

    try {
        await ensureJuridicaDetailStorage();

        const tenantId = process.env.AZURE_TENANT_ID;
        const clientId = process.env.AZURE_CLIENT_ID;
        const clientSecret = process.env.AZURE_CLIENT_SECRET;

        // 1. Obtener Token de la Aplicación (Client Credentials)
        const fetchFn = process.env.fetch || global.fetch || fetch;
        const tokenRes = await fetchFn(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                client_id: clientId,
                scope: 'https://graph.microsoft.com/.default',
                client_secret: clientSecret,
                grant_type: 'client_credentials'
            })
        }).then(r => r.json());

        const token = tokenRes.access_token;
        if (!token) throw new Error('No se pudo obtener el token de Azure AD');

        // 2. Traer el codigo de la solicitud para el nombre de la carpeta
        const codRes = await pool.query('SELECT codigo FROM solicitudes WHERE id = $1', [solicitudId]);
        const codigo = codRes.rows[0]?.codigo || `Solicitud_${solicitudId.substring(0, 6)}`;

        // 3. Crear la carpeta principal
        const driveUrl = `https://graph.microsoft.com/v1.0/sites/investinbogota.sharepoint.com:/sites/Documental:/drive/root/children`;

        const mainRes = await fetch(driveUrl, {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name: `Expediente_${codigo}`,
                folder: {},
                '@microsoft.graph.conflictBehavior': 'rename'
            })
        });

        if (!mainRes.ok) {
            const err = await mainRes.text();
            throw new Error('Graph API Error crear main: ' + err);
        }

        const mainData = await mainRes.json();
        const mainFolderId = mainData.id;

        // 4. Crear subcarpetas
        const subs = ['Precontractual', 'Contractual', 'Postcontractual'];
        for (const sub of subs) {
            await fetch(`https://graph.microsoft.com/v1.0/sites/investinbogota.sharepoint.com:/sites/Documental:/drive/items/${mainFolderId}/children`, {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: sub,
                    folder: {},
                    '@microsoft.graph.conflictBehavior': 'fail'
                })
            });
        }

        // Marcamos el repositorio como creado en la BD
        await pool.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, repositorio_sharepoint_creado, actualizado_en)
             VALUES ($1::uuid, TRUE, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET repositorio_sharepoint_creado = TRUE, actualizado_en = NOW()`,
            [solicitudId]
        );

        return res.json({ success: true, message: 'Repositorio de SharePoint con 3 carpetas creado exitosamente.' });
    } catch (err) {
        console.error('Error creando repo SharePoint Backend:', err);
        return res.status(500).json({ error: 'Error al crear repositorio en SharePoint (Backend).' });
    }
});

// ─── RUTA: Dashboard del administrador ───────────────────────
// GET /api/dashboard
app.get('/api/dashboard', async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM v_dashboard_admin');
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error interno' });
    }
});

// ─── RUTAS PARA PANEL DE GERENTE ────────────────────────────────
// GET /api/gerente/metrics?email=xxx
app.get('/api/gerente/metrics', async (req, res) => {
    const { email } = req.query;
    try {
        const userRes = await pool.query('SELECT gerencia_id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Gerente no encontrado' });
        const gerenciaId = userRes.rows[0].gerencia_id;

        const statsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE estado = 'enviado_gerente') as pendientes,
                COUNT(*) FILTER (WHERE estado NOT IN ('borrador', 'enviado_gerente', 'rechazado_gerente')) as aprobadas,
                SUM(valor_en_cop) FILTER (WHERE estado NOT IN ('borrador', 'enviado_gerente', 'rechazado_gerente')) as valor_total,
                (SELECT COUNT(DISTINCT solicitante_id) FROM solicitudes WHERE gerencia_id = $1) as solicitantes
            FROM solicitudes 
            WHERE gerencia_id = $1
        `;
        const statsRes = await pool.query(statsQuery, [gerenciaId]);

        // Datos para la gráfica (últimos 6 meses)
        const chartQuery = `
            SELECT 
                TO_CHAR(creado_en, 'TMMon') as name, 
                SUM(COALESCE(valor_en_cop, 0))::bigint as valor
            FROM solicitudes 
            WHERE gerencia_id = $1 
              AND creado_en >= NOW() - INTERVAL '6 months'
            GROUP BY TO_CHAR(creado_en, 'TMMon'), DATE_TRUNC('month', creado_en)
            ORDER BY DATE_TRUNC('month', creado_en)
        `;
        const chartRes = await pool.query(chartQuery, [gerenciaId]);

        // Actividad reciente
        const activityQuery = `
            SELECT
                s.id, COALESCE(NULLIF(s.titulo_contrato, ''), s.objeto) as project, u.nombre as user, s.estado as status,
                CASE
                    WHEN s.actualizado_en > NOW() - INTERVAL '1 hour' THEN 'Hace unos minutos'
                    WHEN s.actualizado_en > NOW() - INTERVAL '24 hours' THEN 'Hoy'
                    ELSE TO_CHAR(s.actualizado_en, 'DD Mon')
                END as date
            FROM solicitudes s
            JOIN usuarios u ON s.solicitante_id = u.id
            WHERE s.gerencia_id = $1
            ORDER BY s.actualizado_en DESC
            LIMIT 5
        `;
        const activityRes = await pool.query(activityQuery, [gerenciaId]);

        return res.json({
            stats: statsRes.rows[0],
            chart: chartRes.rows,
            activity: activityRes.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener métricas' });
    }
});

// GET /api/gerente/historial?email=xxx
app.get('/api/gerente/historial', async (req, res) => {
    const { email } = req.query;
    try {
        const userRes = await pool.query('SELECT gerencia_id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Gerente no encontrado' });
        const gerenciaId = userRes.rows[0].gerencia_id;

        const result = await pool.query(
            `SELECT * FROM v_solicitudes_resumen WHERE gerencia_id = $1 ORDER BY actualizado_en DESC`,
            [gerenciaId]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener historial' });
    }
});

// GET /api/gerente/contratos?email=xxx
// Contratos/solicitudes de la gerencia del gerente (visión de avance, no solo decisión)
app.get('/api/gerente/contratos', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });
    try {
        const userRes = await pool.query('SELECT gerencia_id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.status(404).json({ error: 'Gerente no encontrado' });
        const gerenciaId = userRes.rows[0].gerencia_id;

        const result = await pool.query(
            `SELECT s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.moneda, s.valor_en_cop, s.valor_estimado,
                    s.valor_moneda_cop_texto, s.valor_moneda_usd_texto, s.valor_moneda_eur_texto,
                    s.plazo_ejecucion_meses, s.plazo_ejecucion_dias, s.creado_en,
                    u_sol.nombre AS solicitante_nombre,
                    (SELECT p.nombre_proveedor FROM proponentes p
                     WHERE p.solicitud_id = s.id ORDER BY p.seleccionado DESC NULLS LAST, p.numero ASC LIMIT 1) AS proveedor_nombre,
                    COALESCE(SUM(CASE WHEN fc.pagado_financiera = true THEN fc.valor ELSE 0 END), 0)::numeric AS total_facturado,
                    COUNT(CASE WHEN fc.pagado_financiera = true THEN 1 END)::int AS facturas_aprobadas,
                    COUNT(fc.id)::int AS total_facturas
             FROM solicitudes s
             JOIN usuarios u_sol ON s.solicitante_id = u_sol.id
             LEFT JOIN facturas_contrato fc ON fc.solicitud_id = s.id
             WHERE s.gerencia_id = $1
               AND s.estado != 'borrador'
             GROUP BY s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.moneda, s.valor_en_cop, s.valor_estimado,
                      s.valor_moneda_cop_texto, s.valor_moneda_usd_texto, s.valor_moneda_eur_texto,
                      s.plazo_ejecucion_meses, s.plazo_ejecucion_dias, s.creado_en, u_sol.nombre
             ORDER BY s.actualizado_en DESC`,
            [gerenciaId]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener contratos de la gerencia' });
    }
});

// ─── RUTAS PARA PANEL DE FINANCIERA ──────────────────────────
// GET /api/financiera/metrics
app.get('/api/financiera/metrics', async (req, res) => {
    try {
        // Métricas globales para financiera (ven todo lo que entra a su bandeja o ya pasó)
        const statsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE estado = 'en_financiera') as pendientes,
                COUNT(*) FILTER (WHERE estado IN ('aprobado_financiera', 'aprobado_comite', 'en_juridica', 'enviado_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite', 'finalizado')) as aprobadas,
                SUM(valor_en_cop) FILTER (WHERE estado IN ('aprobado_financiera', 'aprobado_comite', 'en_juridica', 'enviado_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite', 'finalizado')) as valor_total,
                (SELECT COUNT(*) FROM usuarios WHERE rol = 'supervisor') as solicitantes
            FROM solicitudes 
        `;
        const statsRes = await pool.query(statsQuery);

        // Datos para la gráfica (últimos 6 meses de lo aprobado por financiera)
        const chartQuery = `
            SELECT 
                TO_CHAR(actualizado_en, 'TMMon') as name, 
                SUM(COALESCE(presupuesto_aprobado, valor_en_cop, 0))::bigint as valor
            FROM solicitudes 
            WHERE estado IN ('aprobado_financiera', 'aprobado_comite', 'en_juridica', 'enviado_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite', 'finalizado')
              AND actualizado_en >= NOW() - INTERVAL '6 months'
            GROUP BY TO_CHAR(actualizado_en, 'TMMon'), DATE_TRUNC('month', actualizado_en)
            ORDER BY DATE_TRUNC('month', actualizado_en)
        `;
        const chartRes = await pool.query(chartQuery);

        // Actividad reciente (movimientos en financiera)
        const activityQuery = `
            SELECT
                s.id, COALESCE(NULLIF(s.titulo_contrato, ''), s.objeto) as project, u.nombre as user, s.estado as status,
                CASE
                    WHEN s.actualizado_en > NOW() - INTERVAL '1 hour' THEN 'Hace unos minutos'
                    WHEN s.actualizado_en > NOW() - INTERVAL '24 hours' THEN 'Hoy'
                    ELSE TO_CHAR(s.actualizado_en, 'DD Mon')
                END as date
            FROM solicitudes s
            JOIN usuarios u ON s.solicitante_id = u.id
            WHERE s.estado IN ('en_financiera', 'aprobado_financiera', 'rechazado_financiera', 'aprobado_comite', 'rechazado_comite', 'en_juridica', 'en_juridica_concepto', 'en_riesgos', 'rechazado_riesgos', 'en_comite')
            ORDER BY s.actualizado_en DESC
            LIMIT 5
        `;
        const activityRes = await pool.query(activityQuery);

        return res.json({
            stats: statsRes.rows[0],
            chart: chartRes.rows,
            activity: activityRes.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener métricas financieras' });
    }
});

// GET /api/financiera/historial
app.get('/api/financiera/historial', async (req, res) => {
    try {
        // La financiera ve todo el flujo que ya pasó por ellos o está en proceso
        const result = await pool.query(
            `SELECT * FROM v_solicitudes_resumen 
             WHERE estado NOT IN ('borrador', 'enviado_gerente', 'rechazado_gerente')
             ORDER BY actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener historial financiero' });
    }
});

// GET /api/financiera/pagos
app.get('/api/financiera/pagos', async (req, res) => {
    try {
        // En Control de Pagos se muestran las solicitudes que ya tienen rubro y presupuesto aprobado
        const result = await pool.query(
            `SELECT 
                id, codigo, objeto, solicitante_nombre, gerencia_nombre,
                actualizado_en as fecha, presupuesto_aprobado as monto, estado, rubro, forma_pago
             FROM v_solicitudes_resumen 
             WHERE rubro IS NOT NULL AND presupuesto_aprobado > 0
             ORDER BY actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener control de pagos' });
    }
});

app.get('/api/financiera/reporte_consumo', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT g.nombre as gerencia, SUM(s.presupuesto_aprobado) as total
             FROM gerencias g
             LEFT JOIN solicitudes s ON g.id = s.gerencia_id
             WHERE s.estado IN ('aprobado_financiera', 'aprobado_comite', 'en_juridica', 'enviado_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite', 'finalizado')
             GROUP BY g.nombre`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener reporte de consumo' });
    }
});

// ─── PRESUPUESTO POR VIGENCIA ────────────────────────────────
async function ensurePresupuestoVigencia() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS presupuesto_vigencia (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            gerencia_nombre VARCHAR(255) NOT NULL,
            vigencia INTEGER NOT NULL,
            monto_total NUMERIC(18,2) NOT NULL DEFAULT 0,
            comprometido_vigencia_anterior NUMERIC(18,2) NOT NULL DEFAULT 0,
            creado_en TIMESTAMPTZ DEFAULT NOW(),
            actualizado_en TIMESTAMPTZ DEFAULT NOW(),
            UNIQUE(gerencia_nombre, vigencia)
        )
    `);
    // Migración no destructiva: agrega la columna si la tabla ya existía sin ella
    await pool.query(`
        ALTER TABLE presupuesto_vigencia
        ADD COLUMN IF NOT EXISTS comprometido_vigencia_anterior NUMERIC(18,2) NOT NULL DEFAULT 0
    `);
}

// GET /api/financiera/presupuesto-vigencia?vigencia=2026
app.get('/api/financiera/presupuesto-vigencia', async (req, res) => {
    const vigencia = parseInt(req.query.vigencia) || new Date().getFullYear();
    try {
        await ensurePresupuestoVigencia();
        await ensureReconocimientosGasto();
        const result = await pool.query(
            `SELECT
                pv.id,
                pv.gerencia_nombre,
                pv.vigencia,
                pv.monto_total::bigint AS monto_total,
                pv.comprometido_vigencia_anterior::bigint AS comprometido_vigencia_anterior,

                -- Comprometido FIRME: jurídica aprobó = contrato firmado
                COALESCE(SUM(s.presupuesto_aprobado) FILTER (
                    WHERE s.estado IN ('aprobado_juridica','finalizado','contratado','cerrado')
                ), 0)::bigint AS comprometido,

                -- Certificado: CDP emitido, aún en trámite (puede liberarse si comité/jurídica rechazan)
                COALESCE(SUM(s.presupuesto_aprobado) FILTER (
                    WHERE s.estado IN ('aprobado_financiera','aprobado_comite','en_juridica','enviado_juridica','en_juridica_concepto','en_riesgos','en_comite')
                ), 0)::bigint AS certificado,

                -- Reconocido: gastos menores (transporte, alimentación, etc.) ya ejecutados, fuera del flujo de solicitudes
                (SELECT COALESCE(SUM(rg.monto), 0) FROM reconocimientos_gasto rg
                  WHERE rg.gerencia_nombre = pv.gerencia_nombre AND rg.vigencia = pv.vigencia AND rg.estado = 'activo'
                )::bigint AS reconocido_gasto,

                -- Disponible real = total − reservas vigencia anterior − comprometido firme − certificado − reconocido
                (pv.monto_total
                    - pv.comprometido_vigencia_anterior
                    - COALESCE(SUM(s.presupuesto_aprobado) FILTER (WHERE s.estado IN ('aprobado_juridica','finalizado','contratado','cerrado')), 0)
                    - COALESCE(SUM(s.presupuesto_aprobado) FILTER (WHERE s.estado IN ('aprobado_financiera','aprobado_comite','en_juridica','enviado_juridica','en_juridica_concepto','en_riesgos','en_comite')), 0)
                    - (SELECT COALESCE(SUM(rg.monto), 0) FROM reconocimientos_gasto rg
                        WHERE rg.gerencia_nombre = pv.gerencia_nombre AND rg.vigencia = pv.vigencia AND rg.estado = 'activo')
                )::bigint AS disponible,

                -- Disponible para trámite = asignado − comprometido firme − CDP en trámite − reconocido (no descuenta reservas)
                (pv.monto_total
                    - COALESCE(SUM(s.presupuesto_aprobado) FILTER (WHERE s.estado IN ('aprobado_juridica','finalizado','contratado','cerrado')), 0)
                    - COALESCE(SUM(s.presupuesto_aprobado) FILTER (WHERE s.estado IN ('aprobado_financiera','aprobado_comite','en_juridica','enviado_juridica','en_juridica_concepto','en_riesgos','en_comite')), 0)
                    - (SELECT COALESCE(SUM(rg.monto), 0) FROM reconocimientos_gasto rg
                        WHERE rg.gerencia_nombre = pv.gerencia_nombre AND rg.vigencia = pv.vigencia AND rg.estado = 'activo')
                )::bigint AS disponible_tramite

             FROM presupuesto_vigencia pv
             LEFT JOIN solicitudes s
               ON s.rubro = pv.gerencia_nombre
              AND EXTRACT(YEAR FROM s.actualizado_en) = pv.vigencia
             WHERE pv.vigencia = $1
             GROUP BY pv.id, pv.gerencia_nombre, pv.vigencia, pv.monto_total, pv.comprometido_vigencia_anterior
             ORDER BY pv.gerencia_nombre`,
            [vigencia]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error('Error presupuesto-vigencia GET:', err);
        return res.status(500).json({ error: 'Error al obtener presupuesto de vigencia' });
    }
});

// POST /api/financiera/presupuesto-vigencia  { vigencia, gerencia_nombre, monto_total, comprometido_vigencia_anterior }
app.post('/api/financiera/presupuesto-vigencia', async (req, res) => {
    const { vigencia, gerencia_nombre, monto_total, comprometido_vigencia_anterior } = req.body;
    if (!vigencia || !gerencia_nombre || monto_total == null) {
        return res.status(400).json({ error: 'Se requieren vigencia, gerencia_nombre y monto_total' });
    }
    const reservaAnterior = Number(comprometido_vigencia_anterior) || 0;
    if (reservaAnterior < 0) {
        return res.status(400).json({ error: 'Las reservas de vigencias anteriores no pueden ser negativas.' });
    }
    if (reservaAnterior > Number(monto_total)) {
        return res.status(400).json({ error: 'Las reservas de vigencias anteriores no pueden superar el monto apropiado.' });
    }
    try {
        await ensurePresupuestoVigencia();
        const result = await pool.query(
            `INSERT INTO presupuesto_vigencia (gerencia_nombre, vigencia, monto_total, comprometido_vigencia_anterior)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (gerencia_nombre, vigencia)
             DO UPDATE SET
                monto_total = EXCLUDED.monto_total,
                comprometido_vigencia_anterior = EXCLUDED.comprometido_vigencia_anterior,
                actualizado_en = NOW()
             RETURNING id, gerencia_nombre, vigencia, monto_total::bigint, comprometido_vigencia_anterior::bigint`,
            [gerencia_nombre, vigencia, monto_total, reservaAnterior]
        );
        return res.status(200).json(result.rows[0]);
    } catch (err) {
        console.error('Error presupuesto-vigencia POST:', err);
        return res.status(500).json({ error: 'Error al guardar presupuesto de vigencia' });
    }
});

// ─── RECONOCIMIENTO DE GASTO (gastos menores fuera del flujo de solicitudes) ──
async function ensureReconocimientosGasto() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS reconocimientos_gasto (
            id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
            gerencia_nombre VARCHAR(255) NOT NULL,
            vigencia INTEGER NOT NULL,
            concepto VARCHAR(50) NOT NULL,
            descripcion TEXT,
            monto NUMERIC(18,2) NOT NULL,
            fecha_gasto DATE NOT NULL,
            soporte_url TEXT,
            soporte_nombre TEXT,
            registrado_por_email VARCHAR(255),
            registrado_por_nombre VARCHAR(255),
            estado VARCHAR(20) NOT NULL DEFAULT 'activo',
            motivo_anulacion TEXT,
            anulado_por_email VARCHAR(255),
            anulado_en TIMESTAMPTZ,
            creado_en TIMESTAMPTZ DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_reconocimientos_gasto_gerencia_vigencia
        ON reconocimientos_gasto (gerencia_nombre, vigencia, estado)
    `);
}

const uploadReconocimientos = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, RECONOCIMIENTOS_UPLOADS_DIR),
        filename: (_req, file, cb) => {
            const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
            const ext = path.extname(file.originalname);
            cb(null, `${unique}${ext}`);
        }
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
});

// POST /api/financiera/reconocimientos-gasto/upload — sube el soporte (imagen/PDF)
app.post('/api/financiera/reconocimientos-gasto/upload', (req, res) => {
    uploadReconocimientos.single('file')(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err.message);
            return res.status(400).json({ error: err.message || 'Error al procesar el archivo' });
        }
        if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
        const url = `/api/uploads/reconocimientos/${req.file.filename}`;
        return res.json({ url, nombre: req.file.originalname });
    });
});

// GET /api/financiera/reconocimientos-gasto?vigencia=2026&gerencia_nombre=...
app.get('/api/financiera/reconocimientos-gasto', async (req, res) => {
    const vigencia = parseInt(req.query.vigencia) || new Date().getFullYear();
    const gerencia_nombre = req.query.gerencia_nombre;
    if (!gerencia_nombre) return res.status(400).json({ error: 'Se requiere gerencia_nombre' });
    try {
        await ensureReconocimientosGasto();
        const result = await pool.query(
            `SELECT id, gerencia_nombre, vigencia, concepto, descripcion, monto::bigint AS monto,
                    fecha_gasto, soporte_url, soporte_nombre, registrado_por_email, registrado_por_nombre,
                    estado, motivo_anulacion, anulado_por_email, anulado_en, creado_en
             FROM reconocimientos_gasto
             WHERE vigencia = $1 AND gerencia_nombre = $2
             ORDER BY fecha_gasto DESC, creado_en DESC`,
            [vigencia, gerencia_nombre]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error('Error reconocimientos-gasto GET:', err);
        return res.status(500).json({ error: 'Error al obtener reconocimientos de gasto' });
    }
});

// POST /api/financiera/reconocimientos-gasto — registra un gasto menor reconocido
app.post('/api/financiera/reconocimientos-gasto', async (req, res) => {
    const {
        gerencia_nombre, vigencia, concepto, descripcion, monto, fecha_gasto,
        soporte_url, soporte_nombre, registrado_por_email, registrado_por_nombre,
    } = req.body;
    if (!gerencia_nombre || !vigencia || !concepto || !fecha_gasto) {
        return res.status(400).json({ error: 'Se requieren gerencia_nombre, vigencia, concepto y fecha_gasto' });
    }
    const montoNum = Number(monto);
    if (!montoNum || montoNum <= 0) {
        return res.status(400).json({ error: 'Ingrese un monto válido mayor a cero.' });
    }
    try {
        await ensureReconocimientosGasto();
        const result = await pool.query(
            `INSERT INTO reconocimientos_gasto
               (gerencia_nombre, vigencia, concepto, descripcion, monto, fecha_gasto,
                soporte_url, soporte_nombre, registrado_por_email, registrado_por_nombre)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
             RETURNING id, gerencia_nombre, vigencia, concepto, descripcion, monto::bigint AS monto,
                       fecha_gasto, soporte_url, soporte_nombre, registrado_por_email, registrado_por_nombre,
                       estado, creado_en`,
            [gerencia_nombre, vigencia, concepto, descripcion || null, montoNum, fecha_gasto,
                soporte_url || null, soporte_nombre || null, registrado_por_email || null, registrado_por_nombre || null]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error('Error reconocimientos-gasto POST:', err);
        return res.status(500).json({ error: 'Error al registrar el reconocimiento de gasto' });
    }
});

// PATCH /api/financiera/reconocimientos-gasto/:id/anular — anula (soft-delete) un reconocimiento
app.patch('/api/financiera/reconocimientos-gasto/:id/anular', async (req, res) => {
    const { id } = req.params;
    const { motivo, anulado_por_email } = req.body;
    if (!motivo || !String(motivo).trim()) {
        return res.status(400).json({ error: 'Se requiere el motivo de anulación.' });
    }
    try {
        await ensureReconocimientosGasto();
        const actual = await pool.query('SELECT estado FROM reconocimientos_gasto WHERE id = $1', [id]);
        if (actual.rows.length === 0) return res.status(404).json({ error: 'Reconocimiento no encontrado' });
        if (actual.rows[0].estado === 'anulado') {
            return res.status(409).json({ error: 'Este reconocimiento ya fue anulado.' });
        }
        const result = await pool.query(
            `UPDATE reconocimientos_gasto
             SET estado = 'anulado', motivo_anulacion = $2, anulado_por_email = $3, anulado_en = NOW()
             WHERE id = $1
             RETURNING id, estado, motivo_anulacion, anulado_por_email, anulado_en`,
            [id, motivo.trim(), anulado_por_email || null]
        );
        return res.json(result.rows[0]);
    } catch (err) {
        console.error('Error reconocimientos-gasto anular:', err);
        return res.status(500).json({ error: 'Error al anular el reconocimiento de gasto' });
    }
});

// ─── RUTAS PARA PANEL DE JURÍDICA ────────────────────────────
async function ensureJuridicaDetailStorage() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS solicitudes_detalle_juridico (
            solicitud_id UUID PRIMARY KEY REFERENCES solicitudes(id) ON DELETE CASCADE,
            evaluacion_json JSONB NOT NULL DEFAULT '{}'::jsonb,
            documentos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
            repositorio_sharepoint_creado BOOLEAN NOT NULL DEFAULT FALSE,
            actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`ALTER TABLE solicitudes_detalle_juridico ADD COLUMN IF NOT EXISTS evaluacion_json JSONB NOT NULL DEFAULT '{}'::jsonb`);
    await pool.query(`ALTER TABLE solicitudes_detalle_juridico ADD COLUMN IF NOT EXISTS documentos_json JSONB NOT NULL DEFAULT '[]'::jsonb`);
    await pool.query(`ALTER TABLE solicitudes_detalle_juridico ADD COLUMN IF NOT EXISTS repositorio_sharepoint_creado BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE solicitudes_detalle_juridico ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
}

/** Modalidades que siguen el flujo secuencial de 5 pasos en Jurídica. */
function requiereFlujoSecuencialJuridica(modalidad) {
    const m = String(modalidad || '').toLowerCase();
    return m === 'directa' || m === 'tdr' || m === 'invitacion';
}

// Se basa en si ya se envió el enlace formal a AL MENOS UN proponente (ci.link_enviado_en),
// no en c.fase_invitacion_enviada — esa bandera solo se marca cuando TODOS los invitados ya
// completaron su registro RA1-4, y el paso "Invitación" del flujo no debe quedar bloqueado
// mientras Jurídica espera a algún rezagado que aún no se registra.
async function invitacionesEnviadasPara(solicitudId) {
    const r = await pool.query(
        `SELECT EXISTS (
            SELECT 1 FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE c.solicitud_id = $1::uuid
               AND ci.link_enviado_en IS NOT NULL
         ) AS enviadas`,
        [solicitudId]
    );
    return Boolean(r.rows[0]?.enviadas);
}

async function obtenerEstadoFlujoJuridica(solicitudId) {
    const detRes = await pool.query(
        `SELECT evaluacion_json, documentos_json
           FROM solicitudes_detalle_juridico
          WHERE solicitud_id = $1::uuid`,
        [solicitudId]
    );
    const ev = detRes.rows[0]?.evaluacion_json || {};
    const flujo = ev.flujo || {};
    const docs = Array.isArray(detRes.rows[0]?.documentos_json) ? detRes.rows[0].documentos_json : [];
    const calificaciones = Array.isArray(ev.calificaciones) ? ev.calificaciones : [];

    return {
        revisionInicialCompletada: Boolean(flujo.revision_inicial_completada),
        invitacionesEnviadas: await invitacionesEnviadasPara(solicitudId),
        calificacionGuardada: calificaciones.length > 0,
        actaAdjudicacionGenerada: Boolean(ev.acta_generada),
        tieneContratoOrdenCompra: docs.some((d) => d.tipo === 'contrato_orden_compra'),
        tieneActaSupervision: docs.some((d) => d.tipo === 'acta_supervision'),
    };
}

function pasoFlujoCompletado(paso, estado) {
    switch (paso) {
        case 'revision_inicial': return estado.revisionInicialCompletada;
        case 'invitacion': return estado.invitacionesEnviadas;
        case 'calificacion': return estado.calificacionGuardada;
        case 'adjudicacion': return estado.actaAdjudicacionGenerada;
        case 'documentos_finales': return estado.tieneContratoOrdenCompra && estado.tieneActaSupervision;
        default: return false;
    }
}

const ORDEN_FLUJO_JURIDICA = ['revision_inicial', 'invitacion', 'calificacion', 'adjudicacion', 'documentos_finales'];
// Directa no requiere invitación/calificación/adjudicación: no hay competencia entre proponentes.
const ORDEN_FLUJO_JURIDICA_DIRECTA = ['revision_inicial', 'documentos_finales'];
const LABEL_PASO_JURIDICA = {
    revision_inicial: 'Revisión inicial',
    invitacion: 'Invitación',
    calificacion: 'Calificación',
    adjudicacion: 'Adjudicación',
    documentos_finales: 'Cargue de documentos finales',
};

function ordenFlujoParaModalidad(modalidad) {
    const m = String(modalidad || '').toLowerCase();
    return m === 'directa' ? ORDEN_FLUJO_JURIDICA_DIRECTA : ORDEN_FLUJO_JURIDICA;
}

function pasoFlujoAccesible(paso, estado, orden = ORDEN_FLUJO_JURIDICA) {
    const idx = orden.indexOf(paso);
    if (idx <= 0) return true;
    return pasoFlujoCompletado(orden[idx - 1], estado);
}

function mensajeFlujoIncompleto(estado, orden = ORDEN_FLUJO_JURIDICA) {
    for (const paso of orden) {
        if (!pasoFlujoCompletado(paso, estado)) {
            return `Complete el paso "${LABEL_PASO_JURIDICA[paso]}" antes de aprobar legalmente.`;
        }
    }
    return 'Complete todos los pasos del flujo jurídico antes de aprobar.';
}

function validarAccionFlujo(pasoRequerido, estado, orden = ORDEN_FLUJO_JURIDICA) {
    if (!pasoFlujoAccesible(pasoRequerido, estado, orden)) {
        const idx = orden.indexOf(pasoRequerido);
        const prev = idx > 0 ? orden[idx - 1] : null;
        return {
            ok: false,
            error: prev
                ? `Debe completar "${LABEL_PASO_JURIDICA[prev]}" antes de continuar.`
                : 'Flujo jurídico no disponible.',
        };
    }
    return { ok: true };
}

// GET /api/juridica/solicitudes
app.get('/api/juridica/solicitudes', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT id, codigo, objeto, modalidad, solicitante_nombre, gerencia_nombre, estado, actualizado_en
             FROM v_solicitudes_resumen
             WHERE estado IN ('en_juridica', 'en_juridica_concepto')
             ORDER BY actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener solicitudes para jurídica' });
    }
});

// Construye el detalle de calificación (info de solicitud + proponentes + evaluación guardada)
// compartido entre la vista de Jurídica y la vista de Supervisor (calificación concurrente).
async function construirDetalleCalificacion(id) {
        await ensureJuridicaDetailStorage();

        const solRes = await pool.query(
            `SELECT id, codigo, objeto, titulo_contrato, modalidad, solicitante_nombre, gerencia_nombre, estado,
                    descripcion_necesidad_detalle, presupuesto_aprobado, moneda
             FROM v_solicitudes_resumen
             WHERE id = $1::uuid`,
            [id]
        );
        if (solRes.rows.length === 0) return { error: 'Solicitud no encontrada', status: 404 };
        const solicitud = solRes.rows[0];

        // Requisitos generales definidos por el Solicitante en la Planeación Contractual
        // (no están en v_solicitudes_resumen) — se muestran como referencia en la evaluación.
        const planRes = await pool.query(
            `SELECT experiencia_acreditada_exigida, criterios_habilitantes_planeacion
             FROM solicitudes WHERE id = $1::uuid`,
            [id]
        );
        solicitud.experiencia_acreditada_exigida = planRes.rows[0]?.experiencia_acreditada_exigida || null;
        try {
            const raw = planRes.rows[0]?.criterios_habilitantes_planeacion;
            solicitud.criterios_habilitantes_planeacion = raw ? (typeof raw === 'string' ? JSON.parse(raw) : raw) : [];
        } catch {
            solicitud.criterios_habilitantes_planeacion = [];
        }

        // 1. Obtener todas las invitaciones de esta solicitud.
        //    Cada registro de convocatoria_invitaciones es único por ci.id.
        //    No deduplicamos por email aquí para no colapsar proponentes distintos
        //    que compartan email (registros públicos sin email, o datos de prueba).
        //    Solo eliminamos duplicados exactos del mismo ci.id usando DISTINCT ON (ci.id).
        const invRes = await pool.query(
            `SELECT DISTINCT ON (ci.id)
                ci.id,
                ci.proponente_nombre,
                ci.proponente_email,
                ci.cedula_nit,
                ci.telefono,
                ci.es_postulacion_publica,
                ci.respondida,
                ci.respuesta_archivos,
                ci.respuesta_texto as respuesta_proponente,
                ci.creado_en,
                ci.documentos_proveedor,
                ci.tipo_persona,
                ci.tipo_documento,
                c.tipo_objeto
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE c.solicitud_id = $1::uuid
             ORDER BY ci.id, ci.respondida DESC, ci.creado_en DESC`,
            [id]
        );

        // 2. Obtener datos de la investigación de mercado (proponentes registrados por supervisor)
        const propOriginalRes = await pool.query(
            `SELECT * FROM proponentes WHERE solicitud_id = $1::uuid`,
            [id]
        );
        const listaOriginal = propOriginalRes.rows;

        // 2b. Cada ci.id es único — no se necesita deduplicación adicional.
        //     Se ordena para mostrar primero los que respondieron.
        const invUnique = [...invRes.rows].sort((a, b) => {
            if (a.respondida === b.respondida) return 0;
            return a.respondida ? -1 : 1;
        });

        // 3. Cruzar los datos en JS para ser más robustos
        const proponentesFinal = invUnique.map((ci, index) => {
            const normalizar = (val) => String(val || '').trim().toLowerCase();
            const emailInv = normalizar(ci.proponente_email);
            const nombreInv = normalizar(ci.proponente_nombre);

            const match = listaOriginal.find(p =>
                normalizar(p.datos_contacto) === emailInv ||
                normalizar(p.nombre_proveedor) === nombreInv
            );

            // Para proponentes del link público construir datos_contacto con toda la información disponible
            let datosContacto;
            if (ci.es_postulacion_publica) {
                const partes = [ci.proponente_email];
                if (ci.cedula_nit) partes.push(`NIT/Cédula: ${ci.cedula_nit}`);
                if (ci.telefono) partes.push(`Tel: ${ci.telefono}`);
                datosContacto = partes.join(' · ');
            } else {
                datosContacto = match ? match.datos_contacto || ci.proponente_email : ci.proponente_email;
            }

            return {
                id: ci.id,
                numero: index + 1,
                nombre_proveedor: ci.proponente_nombre,
                email: ci.proponente_email,          // campo separado para lookups por email
                datos_contacto: datosContacto,
                cedula_nit: ci.cedula_nit || null,
                telefono: ci.telefono || null,
                es_postulacion_publica: ci.es_postulacion_publica || false,
                respondida: ci.respondida,
                respuesta_archivos: ci.respuesta_archivos,
                respuesta_proponente: ci.respuesta_proponente,
                requisitos_tecnicos: match ? match.requisitos_tecnicos : null,
                experiencia: match ? match.experiencia : null,
                criterios_habilitantes: match ? match.criterios_habilitantes : null,
                valor_con_impuestos: match ? match.valor_con_impuestos : null,
                valor_agregado: match ? match.valor_agregado : null,
                observaciones: match ? match.observaciones : null,
                moneda: match ? match.moneda : 'COP',
                documentos_proveedor: Array.isArray(ci.documentos_proveedor) ? ci.documentos_proveedor : [],
                tipo_persona: ci.tipo_persona || 'empresa',
                tipo_objeto: ci.tipo_objeto || 'bienes_servicios',
                // Señal de que completó el registro RA1-4 en el link público (Fase 1).
                completo_fase1: Boolean(ci.tipo_documento)
            };
        });

        const detRes = await pool.query(
            `SELECT evaluacion_json, repositorio_sharepoint_creado
             FROM solicitudes_detalle_juridico
             WHERE solicitud_id = $1::uuid`,
            [id]
        );

        const evaluacionJson = detRes.rows[0]?.evaluacion_json || {};

        // Merge proponentes_editados guardados para proponentes sin match en tabla (ej. registros públicos)
        const propEditadosGuardados = Array.isArray(evaluacionJson.proponentes_editados)
            ? evaluacionJson.proponentes_editados
            : [];
        if (propEditadosGuardados.length > 0) {
            proponentesFinal.forEach((p) => {
                const guardado = propEditadosGuardados.find(pe => Number(pe.numero) === Number(p.numero));
                if (!guardado) return;
                const campos = ['requisitos_tecnicos', 'experiencia', 'criterios_habilitantes', 'valor_con_impuestos', 'valor_agregado', 'observaciones'];
                campos.forEach(campo => {
                    if ((p[campo] === null || p[campo] === undefined || p[campo] === '') && guardado[campo] != null && guardado[campo] !== '') {
                        p[campo] = guardado[campo];
                    }
                });
            });
        }

        const convCount = await pool.query(
            `SELECT COUNT(*) as total FROM convocatorias WHERE solicitud_id = $1`,
            [id]
        );
        const invEnviadas = await invitacionesEnviadasPara(id);

        return {
            data: {
                solicitud,
                proponentes: proponentesFinal,
                invitaciones_enviadas: invEnviadas,
                total_invitaciones: parseInt(convCount.rows[0].total || '0', 10),
                evaluacion: evaluacionJson,
                repositorio_sharepoint_creado: detRes.rows[0]?.repositorio_sharepoint_creado || false
            }
        };
}

// GET /api/juridica/solicitudes/:id/calificacion
app.get('/api/juridica/solicitudes/:id/calificacion', async (req, res) => {
    const { id } = req.params;
    try {
        const result = await construirDetalleCalificacion(id);
        if (result.error) return res.status(result.status || 500).json({ error: result.error });
        return res.json(result.data);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener calificación jurídica' });
    }
});

// PUT /api/juridica/solicitudes/:id/calificacion
app.put('/api/juridica/solicitudes/:id/calificacion', async (req, res) => {
    const { id } = req.params;
    const {
        calificaciones = [],
        evaluacion_consolidada = '',
        proponente_recomendado_numero = null,
        ganador_email = null,
        ganador_nombre = null,
        ganador_cedula_nit = null,
        cc_recomendado = '',
        dias_limite = '',
        proponentes_editados = [],
        email = null,
        firmas = {},
        finalizada = false
    } = req.body || {};

    const numeroRecomendadoRaw = proponente_recomendado_numero != null ? Number(proponente_recomendado_numero) : null;
    const numeroRecomendado = Number.isFinite(numeroRecomendadoRaw) && numeroRecomendadoRaw > 0
        ? Math.trunc(numeroRecomendadoRaw)
        : null;

    const client = await pool.connect();
    try {
        await ensureJuridicaDetailStorage();
        await client.query('BEGIN');

        const solRes = await client.query('SELECT id, modalidad FROM solicitudes WHERE id = $1::uuid', [id]);
        if (solRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Solicitud no encontrada' });
        }

        if (requiereFlujoSecuencialJuridica(solRes.rows[0].modalidad)) {
            const estadoFlujo = await obtenerEstadoFlujoJuridica(id);
            const gate = validarAccionFlujo('calificacion', estadoFlujo);
            if (!gate.ok) {
                await client.query('ROLLBACK');
                return res.status(409).json({ error: gate.error });
            }
        }

        const prevEvRes = await client.query(
            `SELECT evaluacion_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`,
            [id]
        );
        const prevEv = prevEvRes.rows[0]?.evaluacion_json || {};

        if (prevEv.finalizada === true) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'La calificación ya fue finalizada y no puede modificarse.' });
        }

        if (finalizada === true) {
            const supervisorRecomendado = prevEv.supervisor?.proponente_recomendado_numero != null
                ? Number(prevEv.supervisor.proponente_recomendado_numero)
                : null;
            if (supervisorRecomendado != null && numeroRecomendado != null
                && supervisorRecomendado !== numeroRecomendado
                && !String(evaluacion_consolidada || '').trim()) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: `Jurídica recomienda al Proponente ${numeroRecomendado} y el Supervisor recomienda al Proponente ${supervisorRecomendado}. Debe justificar la decisión en la evaluación consolidada antes de finalizar.`
                });
            }
        }

        // ─── Auditoría de cambios en proponentes ──────────────────
        let userId = null;
        if (email) {
            const uRes = await client.query('SELECT id FROM usuarios WHERE email = $1', [email]);
            if (uRes.rows.length > 0) userId = uRes.rows[0].id;
        }

        if (Array.isArray(proponentes_editados)) {
            // Asegurar columna para auditoria
            await client.query(`ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

            for (const pe of proponentes_editados) {
                const oldProp = await client.query(
                    `SELECT * FROM proponentes WHERE solicitud_id = $1::uuid AND numero = $2`,
                    [id, pe.numero]
                );
                if (oldProp.rows.length > 0) {
                    const op = oldProp.rows[0];
                    const fields = ['datos_contacto', 'requisitos_tecnicos', 'experiencia', 'criterios_habilitantes', 'valor_con_impuestos', 'valor_agregado', 'observaciones', 'correo'];

                    for (const field of fields) {
                        if (pe[field] === undefined) continue;
                        const newVal = pe[field];
                        const oldVal = op[field];

                        let isDifferent = false;
                        if (field === 'valor_con_impuestos') {
                            isDifferent = Math.abs(Number(newVal || 0) - Number(oldVal || 0)) > 0.01;
                        } else {
                            isDifferent = String(newVal || '').trim() !== String(oldVal || '').trim();
                        }

                        if (isDifferent) {
                            await client.query(
                                `UPDATE proponentes SET ${field} = $1, actualizado_en = NOW() WHERE id = $2`,
                                [newVal, op.id]
                            );

                            await client.query(
                                `INSERT INTO auditoria (tabla, registro_id, accion, campo, valor_anterior, valor_nuevo, usuario_id)
                                 VALUES ('proponentes', $1, 'UPDATE', $2, $3, $4, $5)`,
                                [op.id, field, String(oldVal || ''), String(newVal || ''), userId]
                            );
                        }
                    }
                }
            }
        }

        const evaluacion = {
            flujo: prevEv.flujo || {},
            acta_generada: prevEv.acta_generada || false,
            acta_generada_en: prevEv.acta_generada_en || null,
            supervisor: prevEv.supervisor || null,
            finalizada: finalizada === true ? true : (prevEv.finalizada || false),
            finalizada_en: finalizada === true ? new Date().toISOString() : (prevEv.finalizada_en || null),
            // Jurídica no puntúa — solo el Supervisor califica. Aquí únicamente se guarda el
            // checklist de cumplimiento (legal/experiencia/académico) por proponente.
            calificaciones: Array.isArray(calificaciones) ? calificaciones.map((c) => ({
                numero: Number.isFinite(Number(c?.numero)) ? Number(c.numero) : null,
                checklist: c?.checklist || {},
            })) : [],
            proponentes_editados: Array.isArray(proponentes_editados) ? proponentes_editados : [],
            evaluacion_consolidada: String(evaluacion_consolidada || ''),
            proponente_recomendado_numero: numeroRecomendado,
            ganador_email: ganador_email || null,
            ganador_nombre: ganador_nombre || null,
            ganador_cedula_nit: ganador_cedula_nit || null,
            cc_recomendado: String(cc_recomendado || ''),
            dias_limite: String(dias_limite || ''),
            firmas: {
                evaluador: {
                    nombre: String(firmas?.evaluador?.nombre || ''),
                    cargo: String(firmas?.evaluador?.cargo || '')
                },
                profesional: {
                    nombre: String(firmas?.profesional?.nombre || ''),
                    cargo: String(firmas?.profesional?.cargo || '')
                },
                director: {
                    nombre: String(firmas?.director?.nombre || ''),
                    cargo: String(firmas?.director?.cargo || 'Director ejecutivo')
                }
            }
        };

        await client.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, evaluacion_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET evaluacion_json = EXCLUDED.evaluacion_json, actualizado_en = NOW()`,
            [id, JSON.stringify(evaluacion)]
        );

        await client.query(
            `UPDATE proponentes
             SET seleccionado = CASE
                                 WHEN $2::int IS NOT NULL AND numero = $2::int THEN TRUE
                                 ELSE FALSE
                               END
             WHERE solicitud_id = $1::uuid`,
            [id, numeroRecomendado]
        );

        await client.query('COMMIT');

        // Log guardado / finalización de calificación
        const ganadorLabel = ganador_nombre ? ` — Recomendado: ${ganador_nombre}` : '';
        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: id,
            accion: finalizada === true ? 'CALIFICACION_FINALIZADA' : 'CALIFICACION_GUARDADA',
            descripcion: finalizada === true
                ? `Evaluación de proponentes FINALIZADA (documento bloqueado)${ganadorLabel}`
                : `Evaluación de proponentes guardada${ganadorLabel}`,
            usuario_id: userId || null
        });

        return res.json({ ok: true });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error(err);
        return res.status(500).json({
            error: 'Error al guardar calificación jurídica',
            detalle: err?.message || null
        });
    } finally {
        client.release();
    }
});

// POST /api/juridica/solicitudes/:id/flujo/revision-inicial
app.post('/api/juridica/solicitudes/:id/flujo/revision-inicial', async (req, res) => {
    const { id } = req.params;
    const { usuario_email } = req.body || {};
    try {
        await ensureJuridicaDetailStorage();

        const solRes = await pool.query(
            `SELECT id, modalidad, codigo FROM solicitudes WHERE id = $1::uuid`,
            [id]
        );
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
        if (!requiereFlujoSecuencialJuridica(solRes.rows[0].modalidad)) {
            return res.status(400).json({ error: 'Esta modalidad no requiere el flujo secuencial de Jurídica.' });
        }

        const detRes = await pool.query(
            `SELECT evaluacion_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`,
            [id]
        );
        const ev = detRes.rows[0]?.evaluacion_json || {};
        const u = usuario_email ? await usuarioPorEmail(usuario_email) : null;
        const flujo = {
            ...(ev.flujo || {}),
            revision_inicial_completada: true,
            revision_inicial_en: new Date().toISOString(),
            revision_inicial_por: u?.nombre || usuario_email || null,
        };
        const evaluacion = { ...ev, flujo };

        await pool.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, evaluacion_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET evaluacion_json = EXCLUDED.evaluacion_json, actualizado_en = NOW()`,
            [id, JSON.stringify(evaluacion)]
        );

        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: id, accion: 'REVISION_INICIAL',
            descripcion: `Revisión inicial completada para la solicitud ${solRes.rows[0].codigo}`,
            usuario_id: u?.id || null, rol_usuario: u?.rol || 'juridica',
        });

        return res.json({ ok: true, flujo });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar revisión inicial' });
    }
});

// POST /api/juridica/solicitudes/:id/acta-generada
// Registra en auditoría que se generó/descargó el Acta de Adjudicación
app.post('/api/juridica/solicitudes/:id/acta-generada', async (req, res) => {
    const { id } = req.params;
    const { email, ganador_nombre, tipo = 'PDF' } = req.body || {};
    try {
        await ensureJuridicaDetailStorage();

        const solRes = await pool.query(`SELECT modalidad FROM solicitudes WHERE id = $1::uuid`, [id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });

        if (requiereFlujoSecuencialJuridica(solRes.rows[0].modalidad)) {
            const estadoFlujo = await obtenerEstadoFlujoJuridica(id);
            const gate = validarAccionFlujo('adjudicacion', estadoFlujo);
            if (!gate.ok) return res.status(409).json({ error: gate.error });
        }

        const detRes = await pool.query(
            `SELECT evaluacion_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`,
            [id]
        );
        const ev = detRes.rows[0]?.evaluacion_json || {};
        const evaluacion = {
            ...ev,
            acta_generada: true,
            acta_generada_en: new Date().toISOString(),
            acta_generada_tipo: tipo,
        };
        await pool.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, evaluacion_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET evaluacion_json = EXCLUDED.evaluacion_json, actualizado_en = NOW()`,
            [id, JSON.stringify(evaluacion)]
        );

        const uAct = email ? await usuarioPorEmail(email) : null;
        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: id, accion: 'ACTA_GENERADA',
            descripcion: `Acta de Adjudicación generada (${tipo})${ganador_nombre ? ' — Adjudicado: ' + ganador_nombre : ''}`,
            usuario_id: uAct?.id || null, rol_usuario: uAct?.rol || 'juridica'
        });
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error registrando acta generada:', err);
        return res.status(500).json({ error: 'Error al registrar la acción' });
    }
});

// PATCH /api/juridica/solicitudes/:id/codigo
// Cambia el año y consecutivo del código de la solicitud. Solo se permite una vez.
app.patch('/api/juridica/solicitudes/:id/codigo', async (req, res) => {
    const { id } = req.params;
    const { anio, consecutivo } = req.body || {};
    if (!anio || !consecutivo)
        return res.status(400).json({ error: 'Año y consecutivo son requeridos.' });
    if (!/^\d{4}$/.test(String(anio)))
        return res.status(400).json({ error: 'El año debe ser un número de 4 dígitos.' });
    if (!/^\d+$/.test(String(consecutivo)))
        return res.status(400).json({ error: 'El consecutivo debe ser numérico.' });
    try {
        const r = await pool.query(`SELECT codigo, codigo_original FROM solicitudes WHERE id = $1::uuid`, [id]);
        if (r.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada.' });
        const sol = r.rows[0];
        if (sol.codigo_original)
            return res.status(409).json({ error: 'El código ya fue modificado anteriormente. Solo se permite un cambio.' });
        const consec = String(consecutivo).padStart(4, '0');
        const nuevoCodigo = `${anio}-${consec}`;
        const dup = await pool.query(`SELECT id FROM solicitudes WHERE codigo = $1 AND id != $2::uuid`, [nuevoCodigo, id]);
        if (dup.rows.length > 0)
            return res.status(409).json({ error: `El código ${nuevoCodigo} ya está en uso por otra solicitud.` });
        await pool.query(
            `UPDATE solicitudes SET codigo = $1, codigo_original = $2, actualizado_en = NOW() WHERE id = $3::uuid`,
            [nuevoCodigo, sol.codigo, id]
        );
        return res.json({ ok: true, codigo: nuevoCodigo, codigo_original: sol.codigo });
    } catch (err) {
        console.error('[codigo] Error:', err);
        return res.status(500).json({ error: err.message });
    }
});

// GET /api/juridica/solicitudes/:id/documentos
app.get('/api/juridica/solicitudes/:id/documentos', async (req, res) => {
    const { id } = req.params;
    try {
        await ensureJuridicaDetailStorage();

        const solRes = await pool.query(
            `SELECT v.id, v.codigo, v.objeto, v.modalidad, v.solicitante_nombre, v.gerencia_nombre, v.estado,
                    s.supervision_id, s.codigo_original,
                    u.nombre AS supervisor_nombre, u.email AS supervisor_email, u.cargo AS supervisor_cargo
             FROM v_solicitudes_resumen v
             JOIN solicitudes s ON s.id = v.id
             LEFT JOIN usuarios u ON u.id = s.supervision_id
             WHERE v.id = $1::uuid`,
            [id]
        );
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });

        const detRes = await pool.query(
            `SELECT documentos_json
             FROM solicitudes_detalle_juridico
             WHERE solicitud_id = $1::uuid`,
            [id]
        );

        return res.json({
            solicitud: solRes.rows[0],
            documentos: Array.isArray(detRes.rows[0]?.documentos_json) ? detRes.rows[0].documentos_json : []
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener documentos jurídicos' });
    }
});

// POST /api/juridica/solicitudes/:id/documentos
app.post('/api/juridica/solicitudes/:id/documentos', async (req, res) => {
    const { id } = req.params;
    const { nombre, tipo_mime, tamano_bytes, tamaño_bytes, url_storage, descripcion, tipo } = req.body || {};

    if (!nombre) return res.status(400).json({ error: 'nombre es requerido' });

    const tiposFinales = ['contrato_orden_compra', 'acta_supervision'];
    if (tipo && !tiposFinales.includes(tipo) && tipo !== 'otro') {
        return res.status(400).json({ error: 'tipo inválido. Use contrato_orden_compra, acta_supervision u otro.' });
    }

    try {
        await ensureJuridicaDetailStorage();

        const solRes = await pool.query(`SELECT modalidad FROM solicitudes WHERE id = $1::uuid`, [id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });

        if (requiereFlujoSecuencialJuridica(solRes.rows[0].modalidad) && tiposFinales.includes(tipo)) {
            const estadoFlujo = await obtenerEstadoFlujoJuridica(id);
            const gate = validarAccionFlujo('documentos_finales', estadoFlujo, ordenFlujoParaModalidad(solRes.rows[0].modalidad));
            if (!gate.ok) return res.status(409).json({ error: gate.error });
        }

        const detRes = await pool.query(
            `SELECT documentos_json
             FROM solicitudes_detalle_juridico
             WHERE solicitud_id = $1::uuid`,
            [id]
        );

        const documentos = Array.isArray(detRes.rows[0]?.documentos_json) ? detRes.rows[0].documentos_json : [];
        const nuevo = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            nombre: String(nombre),
            tipo: tipo || 'otro',
            tipo_mime: tipo_mime || null,
            tamano_bytes: Number(tamano_bytes || tamaño_bytes || 0) || null,
            url_storage: url_storage || null,
            descripcion: descripcion || null,
            creado_en: new Date().toISOString()
        };
        const actualizados = [...documentos, nuevo];

        await pool.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, documentos_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET documentos_json = EXCLUDED.documentos_json, actualizado_en = NOW()`,
            [id, JSON.stringify(actualizados)]
        );

        return res.status(201).json(nuevo);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al agregar documento jurídico' });
    }
});

// DELETE /api/juridica/solicitudes/:id/documentos/:docId
app.delete('/api/juridica/solicitudes/:id/documentos/:docId', async (req, res) => {
    const { id, docId } = req.params;
    try {
        await ensureJuridicaDetailStorage();
        const detRes = await pool.query(
            `SELECT documentos_json
             FROM solicitudes_detalle_juridico
             WHERE solicitud_id = $1::uuid`,
            [id]
        );

        const documentos = Array.isArray(detRes.rows[0]?.documentos_json) ? detRes.rows[0].documentos_json : [];
        const actualizados = documentos.filter((d) => String(d?.id) !== String(docId));

        await pool.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, documentos_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET documentos_json = EXCLUDED.documentos_json, actualizado_en = NOW()`,
            [id, JSON.stringify(actualizados)]
        );

        const docEliminado = documentos.find(d => String(d?.id) === String(docId));
        await registrarLog({
            tipo_log: 'cambio_datos', modulo: 'juridica', tabla: 'solicitudes_detalle_juridico',
            registro_id: id, accion: 'DELETE',
            campo: 'documentos_json', valor_anterior: docEliminado?.nombre || docId, valor_nuevo: null,
            descripcion: `Eliminó documento jurídico "${docEliminado?.nombre || docId}" de la solicitud ${id}`,
            usuario_id: req.auth?.usuarioId || null, rol_usuario: req.auth?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al eliminar documento jurídico' });
    }
});

// POST /api/juridica/solicitudes/:id/documentos/upload  (multipart)
app.post('/api/juridica/solicitudes/:id/documentos/upload', (req, res, next) => {
    uploadJuridica.single('archivo')(req, res, (err) => {
        if (err instanceof multer.MulterError) return res.status(400).json({ error: err.message });
        if (err) return res.status(400).json({ error: err.message });
        next();
    });
}, async (req, res) => {
    const { id } = req.params;
    const { tipo, descripcion } = req.body || {};
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No se recibió ningún archivo' });

    const tiposPermitidos = ['contrato_orden_compra', 'acta_supervision', 'otro'];
    if (tipo && !tiposPermitidos.includes(tipo)) {
        return res.status(400).json({ error: 'tipo inválido' });
    }

    try {
        await ensureJuridicaDetailStorage();

        const solRes = await pool.query(`SELECT modalidad FROM solicitudes WHERE id = $1::uuid`, [id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });

        if (requiereFlujoSecuencialJuridica(solRes.rows[0].modalidad) && tipo !== 'otro') {
            const estadoFlujo = await obtenerEstadoFlujoJuridica(id);
            const gate = validarAccionFlujo('documentos_finales', estadoFlujo, ordenFlujoParaModalidad(solRes.rows[0].modalidad));
            if (!gate.ok) return res.status(409).json({ error: gate.error });
        }

        const detRes = await pool.query(
            `SELECT documentos_json FROM solicitudes_detalle_juridico WHERE solicitud_id = $1::uuid`, [id]
        );
        const documentos = Array.isArray(detRes.rows[0]?.documentos_json) ? detRes.rows[0].documentos_json : [];
        const url = `/api/uploads/juridica/${file.filename}`;
        const nuevo = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            nombre: file.originalname,
            tipo: tipo || 'otro',
            tipo_mime: file.mimetype || null,
            tamano_bytes: file.size || null,
            url_storage: url,
            descripcion: descripcion || null,
            creado_en: new Date().toISOString()
        };
        const actualizados = [...documentos, nuevo];
        await pool.query(
            `INSERT INTO solicitudes_detalle_juridico (solicitud_id, documentos_json, actualizado_en)
             VALUES ($1::uuid, $2::jsonb, NOW())
             ON CONFLICT (solicitud_id)
             DO UPDATE SET documentos_json = EXCLUDED.documentos_json, actualizado_en = NOW()`,
            [id, JSON.stringify(actualizados)]
        );
        return res.status(201).json(nuevo);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar documento jurídico' });
    }
});

// PATCH /api/juridica/solicitudes/:id/supervisor
app.patch('/api/juridica/solicitudes/:id/supervisor', async (req, res) => {
    const { id } = req.params;
    const { supervision_id } = req.body || {};
    if (!supervision_id) return res.status(400).json({ error: 'supervision_id es requerido' });
    try {
        const check = await pool.query(`SELECT id FROM usuarios WHERE id = $1`, [supervision_id]);
        if (check.rows.length === 0) return res.status(404).json({ error: 'Usuario no encontrado' });
        await pool.query(`UPDATE solicitudes SET supervision_id = $1 WHERE id = $2::uuid`, [supervision_id, id]);
        const uRes = await pool.query(`SELECT nombre, email, cargo FROM usuarios WHERE id = $1`, [supervision_id]);
        return res.json({ ok: true, supervisor: uRes.rows[0] });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar supervisor' });
    }
});

// GET /api/juridica/bandeja
app.get('/api/juridica/bandeja', async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT * FROM v_solicitudes_resumen
             WHERE estado IN ('en_juridica', 'en_juridica_concepto')
             ORDER BY actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener bandeja de jurídica' });
    }
});

// GET /api/juridica/historial
app.get('/api/juridica/historial', async (_req, res) => {
    try {
        await ensureJuridicaDetailStorage();
        const result = await pool.query(
            `SELECT
                s.id,
                s.codigo,
                s.objeto,
                s.titulo_contrato,
                s.modalidad,
                s.estado,
                s.solicitante_nombre,
                s.gerencia_nombre,
                s.actualizado_en,
                CASE
                  WHEN d.evaluacion_json IS NOT NULL
                   AND jsonb_typeof(d.evaluacion_json->'calificaciones') = 'array'
                   AND jsonb_array_length(d.evaluacion_json->'calificaciones') > 0
                  THEN TRUE
                  ELSE FALSE
                END AS tiene_calificacion,
                CASE
                  WHEN d.evaluacion_json IS NOT NULL
                   AND COALESCE(d.evaluacion_json->'firmas'->'director'->>'nombre', '') <> ''
                  THEN TRUE
                  ELSE FALSE
                END AS tiene_firma_adjudica,
                CASE
                  WHEN d.documentos_json IS NOT NULL
                   AND jsonb_typeof(d.documentos_json) = 'array'
                  THEN jsonb_array_length(d.documentos_json)
                  ELSE 0
                END AS documentos_count
             FROM v_solicitudes_resumen s
             LEFT JOIN solicitudes_detalle_juridico d ON d.solicitud_id = s.id
             WHERE s.estado IN ('aprobado_juridica', 'rechazado_juridica', 'finalizado', 'enviado_juridica', 'en_juridica')
             ORDER BY s.actualizado_en DESC`
        );

        const solicitudes = result.rows;
        if (solicitudes.length === 0) return res.json([]);

        // Cargar logs de auditoría para todas las solicitudes en una sola query
        // Incluye: logs directos de la solicitud + logs de convocatorias vinculadas
        const ids = solicitudes.map(s => s.id);
        const logsRes = await pool.query(
            `SELECT sol_id AS registro_id, accion, descripcion, rol_usuario,
                    campo, valor_anterior, valor_nuevo,
                    resultado, creado_en, usuario_nombre
             FROM (
               -- Logs directos de la solicitud
               SELECT a.registro_id::text AS sol_id, a.accion, a.descripcion, a.rol_usuario,
                      a.campo, a.valor_anterior, a.valor_nuevo,
                      a.resultado, a.creado_en,
                      COALESCE(u.nombre, a.rol_usuario, 'Sistema') AS usuario_nombre
               FROM auditoria a
               LEFT JOIN usuarios u ON a.usuario_id = u.id
               WHERE a.registro_id = ANY($1::uuid[])
                 AND a.tabla IN ('solicitudes', 'solicitudes_detalle_juridico')

               UNION ALL

               -- Logs de convocatorias vinculadas a la solicitud
               SELECT c.solicitud_id::text AS sol_id, a.accion, a.descripcion, a.rol_usuario,
                      a.campo, a.valor_anterior, a.valor_nuevo,
                      a.resultado, a.creado_en,
                      COALESCE(u.nombre, a.rol_usuario, 'Sistema') AS usuario_nombre
               FROM auditoria a
               JOIN convocatorias c ON c.id = a.registro_id
               LEFT JOIN usuarios u ON a.usuario_id = u.id
               WHERE c.solicitud_id = ANY($1::uuid[])
                 AND a.tabla = 'convocatorias'
             ) sub
             ORDER BY creado_en ASC`,
            [ids]
        );

        // Agrupar logs por solicitud
        const logsPorSolicitud = {};
        logsRes.rows.forEach(log => {
            const sid = log.registro_id;
            if (!logsPorSolicitud[sid]) logsPorSolicitud[sid] = [];
            logsPorSolicitud[sid].push({
                accion: log.accion,
                descripcion: log.descripcion,
                campo: log.campo,
                valor_anterior: log.valor_anterior,
                valor_nuevo: log.valor_nuevo,
                usuario_nombre: log.usuario_nombre,
                rol_usuario: log.rol_usuario,
                resultado: log.resultado,
                creado_en: log.creado_en
            });
        });

        const response = solicitudes.map(s => ({
            ...s,
            logs: logsPorSolicitud[s.id] || []
        }));

        return res.json(response);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener historial de jurídica' });
    }
});

// GET /api/juridica/metrics
app.get('/api/juridica/metrics', async (req, res) => {
    try {
        const statsQuery = `
            SELECT 
                COUNT(*) FILTER (WHERE s.estado IN ('en_juridica', 'en_juridica_concepto')) as pendientes,
                COUNT(*) FILTER (
                    WHERE s.estado = 'en_juridica'
                      AND d.evaluacion_json IS NOT NULL
                      AND jsonb_typeof(d.evaluacion_json->'calificaciones') = 'array'
                      AND jsonb_array_length(d.evaluacion_json->'calificaciones') > 0
                ) as en_calificacion,
                COUNT(*) FILTER (WHERE s.estado IN ('aprobado_juridica', 'finalizado', 'enviado_juridica')) as aprobadas,
                COUNT(*) FILTER (WHERE s.estado IN ('rechazado_juridica', 'rechazado_comite')) as rechazadas
            FROM solicitudes s
            LEFT JOIN solicitudes_detalle_juridico d ON d.solicitud_id = s.id
        `;
        const result = await pool.query(statsQuery);

        // Actividad reciente para jurídica
        const activityQuery = `
            SELECT s.id, s.codigo, s.objeto, s.titulo_contrato, s.estado, s.actualizado_en as fecha,
                   u.nombre as solicitante_nombre, s.modalidad,
                   s.valor_en_cop, s.valor_estimado, s.moneda,
                   s.valor_moneda_cop_texto, s.valor_moneda_usd_texto
            FROM solicitudes s
            LEFT JOIN usuarios u ON s.solicitante_id = u.id
            WHERE s.estado IN ('en_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite', 'rechazado_riesgos',
                               'aprobado_juridica', 'rechazado_juridica',
                               'rechazado_comite', 'enviado_juridica', 'finalizado', 'contratado')
            ORDER BY s.actualizado_en DESC
            LIMIT 12
        `;
        const activityRes = await pool.query(activityQuery);

        return res.json({
            ...result.rows[0],
            recientes: activityRes.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener métricas de jurídica' });
    }
});

// Contratos aprobados por jurídica (todos los que pasaron por el proceso)
// ?proveedor=<nombre> — opcional, filtra solo los contratos de ese proveedor
// (se usa desde el directorio de Proveedores para mostrar sus contratos).
app.get('/api/juridica/contratos', async (req, res) => {
    const { proveedor } = req.query;
    try {
        const params = [];
        let filtroProveedor = '';
        if (proveedor) {
            params.push(String(proveedor).trim());
            filtroProveedor = `AND UPPER(TRIM(p.nombre_proveedor)) = UPPER(TRIM($${params.length}))`;
        }
        const result = await pool.query(`
            SELECT
                s.id, s.codigo, s.objeto, s.estado, s.moneda,
                s.valor_en_cop, s.valor_estimado,
                s.valor_moneda_cop_texto, s.valor_moneda_usd_texto, s.valor_moneda_eur_texto,
                s.plazo_ejecucion_meses, s.plazo_ejecucion_dias, s.modalidad,
                s.creado_en, s.fecha_respuesta_juridica, s.actualizado_en,
                u_sol.nombre AS solicitante_nombre,
                u_sup.nombre AS supervisor_nombre,
                p.nombre_proveedor, p.valor_con_impuestos,
                COALESCE(sdj.repositorio_sharepoint_creado, false) AS sharepoint_creado
            FROM solicitudes s
            JOIN usuarios u_sol ON s.solicitante_id = u_sol.id
            LEFT JOIN usuarios u_sup ON s.supervision_id = u_sup.id
            LEFT JOIN proponentes p ON p.solicitud_id = s.id AND p.seleccionado = true
            LEFT JOIN solicitudes_detalle_juridico sdj ON sdj.solicitud_id = s.id
            WHERE s.estado NOT IN (
                'borrador', 'enviado_gerente', 'en_financiera',
                'en_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite',
                'rechazado_juridica', 'rechazado_gerente',
                'rechazado_financiera', 'rechazado_comite', 'rechazado_riesgos', 'cancelado'
            )
            ${filtroProveedor}
            ORDER BY s.actualizado_en DESC
        `, params);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener contratos' });
    }
});

// Directorio de proveedores: agrega participaciones (proponentes), evaluaciones
// de desempeño y bloqueos, agrupando por nombre normalizado (no existe tabla
// maestra de proveedores — se deriva de las tablas donde el nombre ya se registra).
app.get('/api/juridica/proveedores', async (_req, res) => {
    try {
        const result = await pool.query(`
            WITH base AS (
                SELECT
                    UPPER(TRIM(p.nombre_proveedor)) AS identificador,
                    (ARRAY_AGG(p.nombre_proveedor ORDER BY p.creado_en DESC))[1] AS nombre,
                    (ARRAY_AGG(COALESCE(NULLIF(p.correo, ''), NULLIF(p.datos_contacto, ''))
                        ORDER BY p.creado_en DESC)
                        FILTER (WHERE COALESCE(NULLIF(p.correo, ''), NULLIF(p.datos_contacto, '')) IS NOT NULL))[1] AS contacto,
                    (ARRAY_AGG(NULLIF(p.correo, '') ORDER BY p.creado_en DESC)
                        FILTER (WHERE NULLIF(p.correo, '') IS NOT NULL))[1] AS correo,
                    COUNT(DISTINCT p.solicitud_id) AS num_procesos,
                    COUNT(*) FILTER (WHERE p.seleccionado) AS num_seleccionado,
                    MAX(p.creado_en) AS ultima_participacion
                FROM proponentes p
                WHERE p.nombre_proveedor IS NOT NULL AND TRIM(p.nombre_proveedor) != ''
                GROUP BY UPPER(TRIM(p.nombre_proveedor))
            ),
            evals AS (
                SELECT DISTINCT ON (UPPER(TRIM(nombre_proveedor)))
                    UPPER(TRIM(nombre_proveedor)) AS identificador,
                    total, fecha_evaluacion, observaciones, correo_proveedor
                FROM evaluaciones_proveedor
                WHERE nombre_proveedor IS NOT NULL AND TRIM(nombre_proveedor) != ''
                ORDER BY UPPER(TRIM(nombre_proveedor)), fecha_evaluacion DESC
            ),
            -- Contratos por proveedor: mismo universo de "contrato" que usa /api/juridica/contratos
            -- (solicitudes que ya salieron del proceso previo a jurídica/comité), y mismo criterio
            -- de vigencia que calcularEstadoContrato() en ContratosJuridica.tsx.
            contratos AS (
                SELECT
                    UPPER(TRIM(p.nombre_proveedor)) AS identificador,
                    COUNT(*)::int AS contratos_totales,
                    COUNT(*) FILTER (
                        WHERE s.estado != 'finalizado'
                          AND (
                            s.fecha_respuesta_juridica IS NULL
                            OR (COALESCE(s.plazo_ejecucion_meses, 0) = 0 AND COALESCE(s.plazo_ejecucion_dias, 0) = 0)
                            OR (s.fecha_respuesta_juridica
                                + (COALESCE(s.plazo_ejecucion_meses, 0) || ' months')::interval
                                + (COALESCE(s.plazo_ejecucion_dias, 0) || ' days')::interval) >= NOW()
                          )
                    )::int AS contratos_activos
                FROM proponentes p
                JOIN solicitudes s ON s.id = p.solicitud_id
                WHERE p.seleccionado = true
                  AND p.nombre_proveedor IS NOT NULL AND TRIM(p.nombre_proveedor) != ''
                  AND s.estado NOT IN (
                    'borrador', 'enviado_gerente', 'en_financiera',
                    'en_juridica', 'en_juridica_concepto', 'en_riesgos', 'en_comite',
                    'rechazado_juridica', 'rechazado_gerente',
                    'rechazado_financiera', 'rechazado_comite', 'rechazado_riesgos', 'cancelado'
                  )
                GROUP BY UPPER(TRIM(p.nombre_proveedor))
            )
            SELECT
                b.identificador,
                b.nombre,
                COALESCE(NULLIF(e.correo_proveedor, ''), b.contacto) AS contacto,
                COALESCE(NULLIF(e.correo_proveedor, ''), b.correo) AS correo,
                b.num_procesos,
                b.num_seleccionado,
                b.ultima_participacion,
                e.total AS ultima_calificacion,
                e.fecha_evaluacion AS fecha_ultima_evaluacion,
                e.observaciones AS observaciones_evaluacion,
                (bl.id IS NOT NULL) AS bloqueado,
                bl.motivo AS motivo_bloqueo,
                COALESCE(c.contratos_activos, 0) AS contratos_activos,
                COALESCE(c.contratos_totales, 0) AS contratos_totales
            FROM base b
            LEFT JOIN evals e ON e.identificador = b.identificador
            LEFT JOIN proveedores_bloqueados bl ON bl.identificador = b.identificador
            LEFT JOIN contratos c ON c.identificador = b.identificador
            ORDER BY b.nombre
        `);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener el directorio de proveedores' });
    }
});

// GET /api/proveedores/formulario-ra14?email=...&nombre=...
// Busca el formulario RA1-4 (Creación o actualización de proveedores) más reciente
// que coincide con este proveedor, para mostrarlo completo en el directorio de Jurídica.
app.get('/api/proveedores/formulario-ra14', async (req, res) => {
    const { email, nombre } = req.query;
    if (!email && !nombre) return res.status(400).json({ error: 'email o nombre requerido' });

    try {
        await ensureConvocatoriasStorage();
        const condiciones = [];
        const params = [];
        if (email) {
            params.push(String(email).trim().toLowerCase());
            condiciones.push(`LOWER(proponente_email) = $${params.length}`);
        }
        if (nombre) {
            params.push(String(nombre).trim());
            condiciones.push(`UPPER(TRIM(proponente_nombre)) = UPPER(TRIM($${params.length}))`);
        }

        const result = await pool.query(
            `SELECT *
             FROM convocatoria_invitaciones
             WHERE (${condiciones.join(' OR ')}) AND tipo_documento IS NOT NULL
             ORDER BY creado_en DESC
             LIMIT 1`,
            params
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Este proveedor no tiene un formulario RA1-4 registrado.' });
        }
        return res.json(result.rows[0]);
    } catch (err) {
        console.error('Error obteniendo formulario RA1-4 del proveedor:', err);
        return res.status(500).json({ error: 'Error al obtener el formulario del proveedor' });
    }
});

// ─── UPLOAD ADJUNTOS FACTURAS ────────────────────────────────────────────────
const uploadFacturas = multer({
    storage: multer.diskStorage({
        destination: (_req, _file, cb) => cb(null, FACTURAS_UPLOADS_DIR),
        filename: (_req, file, cb) => {
            const unique = Date.now() + '-' + Math.round(Math.random() * 1e6);
            const ext = path.extname(file.originalname);
            cb(null, `${unique}${ext}`);
        }
    }),
    limits: { fileSize: 30 * 1024 * 1024 },
});

app.post('/api/facturas/upload', (req, res) => {
    uploadFacturas.single('file')(req, res, (err) => {
        if (err) {
            console.error('Upload error:', err.message);
            return res.status(400).json({ error: err.message || 'Error al procesar el archivo' });
        }
        if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
        const url = `/api/uploads/facturas/${req.file.filename}`;
        return res.json({ url, nombre: req.file.originalname });
    });
});

// ─── FACTURAS POR CONTRATO ────────────────────────────────────────────────────

// GET /api/financiera/contratos — lista de contratos activos para el selector del formulario
// Sólo contratos con jurídica aprobada (contrato firmado) pueden facturar.
// Un contrato 'finalizado' o 'cerrado' ya no admite nuevas facturas, así que
// no se ofrece en el selector (ver también el guard en POST /facturas).
app.get('/api/financiera/contratos', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.codigo, s.objeto, s.titulo_contrato,
                    u.nombre AS supervisor_nombre, u.email AS supervisor_email
             FROM solicitudes s
             LEFT JOIN usuarios u ON u.id = s.supervision_id
             WHERE s.estado IN ('aprobado_juridica','contratado')
             ORDER BY s.codigo DESC`
        );
        const contratos = await Promise.all(result.rows.map(async (c) => {
            const proveedor = await obtenerProveedorContrato(c.id);
            return { ...c, nombre_proveedor: proveedor?.nombre_proveedor || null };
        }));
        return res.json(contratos);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener contratos' });
    }
});

// POST /api/financiera/facturas — financiera registra una factura y la envía a supervisor y gerente
app.post('/api/financiera/facturas', async (req, res) => {
    const {
        solicitud_id, nombre_solicitud, aprobador_1, aprobador_2,
        fecha_factura, no_contrato_oc, no_factura_cxc, numero_ap,
        concepto, valor, certificacion_supervisor, adjunto_url, adjunto_nombre, creado_por_email,
        nombre_proveedor
    } = req.body;

    if (!solicitud_id || !fecha_factura || !no_contrato_oc || !no_factura_cxc || !concepto || !String(numero_ap || '').trim()) {
        return res.status(400).json({ error: 'solicitud_id, fecha_factura, no_contrato_oc, no_factura_cxc, numero_ap y concepto son requeridos' });
    }
    try {
        const solRes = await pool.query('SELECT estado FROM solicitudes WHERE id = $1', [solicitud_id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Solicitud no encontrada' });
        const estadoActual = solRes.rows[0].estado;

        // Un contrato finalizado (evaluación de proveedor firmada) o cerrado
        // ya no admite nuevas facturas.
        if (estadoActual === 'finalizado' || estadoActual === 'cerrado') {
            return res.status(409).json({ error: 'El contrato ya fue finalizado y no admite el registro de nuevas facturas.' });
        }

        const ESTADOS_CONTRATO_FIRMADO = ['aprobado_juridica', 'contratado'];
        if (!ESTADOS_CONTRATO_FIRMADO.includes(estadoActual)) {
            return res.status(409).json({ error: 'No se puede registrar la factura: el contrato aún no ha sido aprobado por jurídica' });
        }

        let proveedorFinal = nombre_proveedor || null;
        if (!proveedorFinal) {
            const proveedor = await obtenerProveedorContrato(solicitud_id);
            proveedorFinal = proveedor?.nombre_proveedor || null;
        }

        const result = await pool.query(
            `INSERT INTO facturas_contrato
               (solicitud_id, nombre_solicitud, aprobador_1, aprobador_2,
                fecha_factura, no_contrato_oc, no_factura_cxc, numero_ap, concepto,
                valor, certificacion_supervisor, adjunto_url, adjunto_nombre, creado_por_email, nombre_proveedor, estado)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'pendiente')
             RETURNING *`,
            [solicitud_id, nombre_solicitud || null, aprobador_1 || null, aprobador_2 || null,
                fecha_factura, no_contrato_oc, no_factura_cxc, numero_ap.trim(), concepto,
                parseFloat(valor) || 0, certificacion_supervisor ?? null, adjunto_url || null, adjunto_nombre || null, creado_por_email || null, proveedorFinal]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar factura' });
    }
});

// PATCH /api/supervisor/facturas/:id/certificar — supervisor aprueba o rechaza la factura
app.patch('/api/supervisor/facturas/:id/certificar', async (req, res) => {
    const { id } = req.params;
    const { aprobado, comentario } = req.body; // aprobado: true | false
    if (typeof aprobado !== 'boolean') {
        return res.status(400).json({ error: '"aprobado" debe ser true o false' });
    }
    if (aprobado === false && !String(comentario || '').trim()) {
        return res.status(400).json({ error: 'comentario es obligatorio al rechazar la factura' });
    }
    try {
        // Recalcular estado global
        const current = await pool.query('SELECT aprobado_gerente FROM facturas_contrato WHERE id=$1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
        const gerenteOk = current.rows[0].aprobado_gerente;
        let nuevoEstado = 'pendiente';
        if (aprobado === false) nuevoEstado = 'rechazada';
        else if (aprobado === true && gerenteOk === true) nuevoEstado = 'aprobada';

        const result = await pool.query(
            `UPDATE facturas_contrato
             SET aprobado_supervisor=$1, comentario_supervisor=$2,
                 certificacion_supervisor=$1,
                 estado=$3, actualizado_en=NOW()
             WHERE id=$4 RETURNING *`,
            [aprobado, comentario || null, nuevoEstado, id]
        );
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al certificar factura' });
    }
});

// GET /api/gerente/facturas — gerente ve todas las facturas pendientes de su aprobación
app.get('/api/gerente/facturas', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT fc.*, s.codigo AS contrato_codigo, s.objeto AS contrato_objeto, s.titulo_contrato AS contrato_titulo
             FROM facturas_contrato fc
             JOIN solicitudes s ON s.id = fc.solicitud_id
             ORDER BY fc.creado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener facturas' });
    }
});

// GET /api/gerente/historial-facturas?email=xxx — facturas donde el gerente ya decidio
app.get('/api/gerente/historial-facturas', async (req, res) => {
    const { email } = req.query;
    try {
        const userRes = await pool.query('SELECT gerencia_id FROM usuarios WHERE email = $1', [email]);
        if (!userRes.rows.length) return res.status(404).json({ error: 'Gerente no encontrado' });
        const gerenciaId = userRes.rows[0].gerencia_id;
        const result = await pool.query(`
            SELECT
                fc.id, fc.no_factura_cxc, fc.no_contrato_oc, fc.numero_ap, fc.concepto, fc.valor,
                fc.fecha_factura, fc.estado, fc.aprobado_gerente, fc.comentario_gerente,
                fc.actualizado_en, fc.creado_en,
                s.codigo AS contrato_codigo, s.objeto AS contrato_objeto, s.titulo_contrato AS contrato_titulo
            FROM facturas_contrato fc
            JOIN solicitudes s ON s.id = fc.solicitud_id
            WHERE s.gerencia_id = $1
              AND fc.aprobado_gerente IS NOT NULL
            ORDER BY fc.actualizado_en DESC
        `, [gerenciaId]);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener historial de facturas' });
    }
});

// PATCH /api/gerente/facturas/:id/aprobar — gerente aprueba o rechaza
app.patch('/api/gerente/facturas/:id/aprobar', async (req, res) => {
    const { id } = req.params;
    const { aprobado, comentario } = req.body;
    if (typeof aprobado !== 'boolean') {
        return res.status(400).json({ error: '"aprobado" debe ser true o false' });
    }
    if (aprobado === false && !String(comentario || '').trim()) {
        return res.status(400).json({ error: 'comentario es obligatorio al rechazar la factura' });
    }
    try {
        const current = await pool.query('SELECT aprobado_supervisor FROM facturas_contrato WHERE id=$1', [id]);
        if (!current.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
        const supervisorOk = current.rows[0].aprobado_supervisor;
        let nuevoEstado = 'pendiente';
        if (aprobado === false) nuevoEstado = 'rechazada';
        else if (aprobado === true && supervisorOk === true) nuevoEstado = 'aprobada';

        const result = await pool.query(
            `UPDATE facturas_contrato
             SET aprobado_gerente=$1, comentario_gerente=$2,
                 estado=$3, actualizado_en=NOW()
             WHERE id=$4 RETURNING *`,
            [aprobado, comentario || null, nuevoEstado, id]
        );
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al aprobar factura' });
    }
});

// GET /api/supervisor/facturas-pendientes?email=
// Todas las facturas pendientes de aprobación del supervisor, a través de todos sus contratos
app.get('/api/supervisor/facturas-pendientes', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });
    try {
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.json([]);
        const userId = userRes.rows[0].id;
        const result = await pool.query(
            `SELECT fc.id, fc.no_factura_cxc, fc.no_contrato_oc, fc.numero_ap, fc.concepto, fc.valor,
                    fc.fecha_factura, fc.estado, fc.aprobado_supervisor,
                    s.id AS solicitud_id, s.codigo AS contrato_codigo, s.objeto AS contrato_objeto
             FROM facturas_contrato fc
             JOIN solicitudes s ON s.id = fc.solicitud_id
             WHERE s.supervision_id = $1
               AND fc.aprobado_supervisor IS NULL
               AND fc.estado = 'pendiente'
             ORDER BY fc.creado_en DESC`,
            [userId]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener facturas pendientes' });
    }
});

// GET /api/supervisor/historial-facturas?email=
// Histórico de facturas ya decididas (aprobadas o rechazadas) por el supervisor/solicitante
app.get('/api/supervisor/historial-facturas', async (req, res) => {
    const { email } = req.query;
    if (!email) return res.status(400).json({ error: 'email requerido' });
    try {
        const userRes = await pool.query('SELECT id FROM usuarios WHERE email = $1', [email]);
        if (userRes.rows.length === 0) return res.json([]);
        const userId = userRes.rows[0].id;
        const result = await pool.query(
            `SELECT fc.id, fc.no_factura_cxc, fc.no_contrato_oc, fc.numero_ap, fc.concepto, fc.valor,
                    fc.fecha_factura, fc.estado, fc.aprobado_supervisor, fc.comentario_supervisor,
                    fc.actualizado_en, fc.creado_en,
                    s.id AS solicitud_id, s.codigo AS contrato_codigo, s.objeto AS contrato_objeto
             FROM facturas_contrato fc
             JOIN solicitudes s ON s.id = fc.solicitud_id
             WHERE s.supervision_id = $1
               AND fc.aprobado_supervisor IS NOT NULL
             ORDER BY fc.actualizado_en DESC`,
            [userId]
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener historial de facturas' });
    }
});

// GET /api/supervisor/contratos/:id/facturas
// Lista facturas + valor del contrato para el resumen de ejecución
app.get('/api/supervisor/contratos/:id/facturas', async (req, res) => {
    const { id } = req.params;
    try {
        const [facturasResult, contratoResult] = await Promise.all([
            pool.query('SELECT * FROM facturas_contrato WHERE solicitud_id = $1 ORDER BY creado_en DESC', [id]),
            pool.query('SELECT valor_en_cop FROM solicitudes WHERE id = $1', [id])
        ]);
        const valorContrato = parseFloat(contratoResult.rows[0]?.valor_en_cop || 0);
        return res.json({ facturas: facturasResult.rows, valor_contrato: valorContrato });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener facturas' });
    }
});

// POST /api/supervisor/contratos/:id/facturas
// Registra una nueva factura para un contrato
app.post('/api/supervisor/contratos/:id/facturas', async (req, res) => {
    const { id } = req.params;
    const {
        nombre_solicitud, aprobador_1, aprobador_2,
        fecha_factura, no_contrato_oc, no_factura_cxc,
        concepto, certificacion_supervisor, adjunto_url,
        creado_por_email, nombre_proveedor
    } = req.body;

    if (!fecha_factura || !no_contrato_oc || !no_factura_cxc || !concepto) {
        return res.status(400).json({ error: 'fecha_factura, no_contrato_oc, no_factura_cxc y concepto son requeridos' });
    }

    try {
        const solRes = await pool.query('SELECT estado FROM solicitudes WHERE id = $1', [id]);
        if (solRes.rows.length === 0) return res.status(404).json({ error: 'Contrato no encontrado' });
        if (['finalizado', 'cerrado'].includes(solRes.rows[0].estado)) {
            return res.status(409).json({ error: 'El contrato ya fue finalizado y no admite el registro de nuevas facturas.' });
        }

        let proveedorFinal = nombre_proveedor || null;
        if (!proveedorFinal) {
            const proveedor = await obtenerProveedorContrato(id);
            proveedorFinal = proveedor?.nombre_proveedor || null;
        }

        const result = await pool.query(
            'INSERT INTO facturas_contrato (solicitud_id, nombre_solicitud, aprobador_1, aprobador_2, fecha_factura, no_contrato_oc, no_factura_cxc, concepto, certificacion_supervisor, adjunto_url, creado_por_email, nombre_proveedor) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING *',
            [
                id,
                nombre_solicitud || null,
                aprobador_1 || null,
                aprobador_2 || null,
                fecha_factura,
                no_contrato_oc,
                no_factura_cxc,
                concepto,
                certificacion_supervisor === true || certificacion_supervisor === 'true',
                adjunto_url || null,
                creado_por_email || null,
                proveedorFinal,
            ]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al registrar factura' });
    }
});

// GET /api/financiera/facturas
// Lista todas las facturas para el área financiera, con datos del contrato
app.get('/api/financiera/facturas', async (_req, res) => {
    try {
        const result = await pool.query(
            'SELECT fc.*, s.codigo AS contrato_codigo, s.objeto AS contrato_objeto, s.titulo_contrato AS contrato_titulo FROM facturas_contrato fc JOIN solicitudes s ON s.id = fc.solicitud_id ORDER BY fc.creado_en DESC'
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener facturas financiera' });
    }
});

// GET /api/financiera/resumen-ejecucion
// Resumen global de ejecución presupuestal: KPIs + detalle por contrato
app.get('/api/financiera/resumen-ejecucion', async (_req, res) => {
    try {
        // KPIs globales
        const kpiResult = await pool.query(`
            SELECT
                COUNT(DISTINCT s.id)::int AS total_contratos,
                COALESCE(SUM(s.valor_en_cop), 0) AS valor_total_contratos,
                COALESCE(SUM(CASE WHEN fc.estado = 'aprobada' THEN fc.valor ELSE 0 END), 0) AS total_facturado,
                COALESCE(SUM(CASE WHEN fc.estado = 'pendiente' THEN fc.valor ELSE 0 END), 0) AS total_pendiente
            FROM solicitudes s
            LEFT JOIN facturas_contrato fc ON fc.solicitud_id = s.id
            WHERE s.estado NOT IN ('borrador', 'rechazado_gerente', 'rechazado_juridica', 'rechazado_financiera', 'rechazado_comite', 'cancelado')
        `);

        // Detalle por contrato
        const detalleResult = await pool.query(`
            SELECT
                s.id,
                s.codigo,
                s.objeto,
                COALESCE(s.valor_en_cop, 0) AS valor_contrato,
                COALESCE(SUM(CASE WHEN fc.estado = 'aprobada' THEN fc.valor ELSE 0 END), 0) AS total_facturado,
                COUNT(CASE WHEN fc.estado = 'aprobada' THEN 1 END)::int AS facturas_aprobadas,
                COUNT(CASE WHEN fc.estado = 'pendiente' THEN 1 END)::int AS facturas_pendientes,
                COUNT(CASE WHEN fc.estado = 'rechazada' THEN 1 END)::int AS facturas_rechazadas,
                COUNT(fc.id)::int AS total_facturas,
                u.nombre AS supervisor_nombre
            FROM solicitudes s
            LEFT JOIN facturas_contrato fc ON fc.solicitud_id = s.id
            LEFT JOIN usuarios u ON u.id = s.supervision_id
            WHERE s.estado NOT IN ('borrador', 'rechazado_gerente', 'rechazado_juridica', 'rechazado_financiera', 'rechazado_comite', 'cancelado')
            GROUP BY s.id, s.codigo, s.objeto, s.valor_en_cop, u.nombre
            ORDER BY total_facturado DESC
        `);

        return res.json({
            kpis: kpiResult.rows[0],
            contratos: detalleResult.rows,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener resumen de ejecución' });
    }
});

// GET /api/financiera/reporte-proveedores
app.get('/api/financiera/reporte-proveedores', async (_req, res) => {
    try {
        const result = await pool.query(`
            SELECT
                s.codigo,
                s.objeto,
                g.nombre AS gerencia,
                s.estado,
                p.numero,
                p.nombre_proveedor,
                p.valor_con_impuestos,
                p.moneda,
                p.seleccionado,
                p.criterios_habilitantes,
                p.valor_agregado,
                p.observaciones
            FROM solicitudes s
            JOIN proponentes p ON p.solicitud_id = s.id
            LEFT JOIN gerencias g ON g.id = s.gerencia_id
            WHERE p.nombre_proveedor IS NOT NULL AND p.nombre_proveedor != ''
            ORDER BY s.codigo NULLS LAST, p.numero
        `);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener reporte de proveedores' });
    }
});

// PATCH /api/financiera/facturas/:id/estado
// Aprobar o rechazar una factura (solo cambia estado y comentario_financiera)
app.patch('/api/financiera/facturas/:id/estado', async (req, res) => {
    const { id } = req.params;
    const { estado, comentario_financiera } = req.body;

    if (!estado || !['aprobada', 'rechazada', 'pendiente'].includes(estado)) {
        return res.status(400).json({ error: "estado debe ser 'aprobada', 'rechazada' o 'pendiente'" });
    }

    try {
        const result = await pool.query(
            'UPDATE facturas_contrato SET estado = $1, comentario_financiera = $2, actualizado_en = NOW() WHERE id = $3 RETURNING *',
            [estado, comentario_financiera || null, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Factura no encontrada' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar estado de factura' });
    }
});

// Upsert de usuario SIN actualizar ultimo_acceso.
// Usar en contextos donde el usuario no está haciendo login (ej: mencionado como supervisor en solicitud).
async function ensureUsuarioExists(azureId, email, nombre, cargo) {
    const result = await pool.query(
        `INSERT INTO usuarios (azure_id, email, nombre, cargo, rol)
         VALUES ($1, $2, $3, $4, 'supervisor')
         ON CONFLICT (email) DO UPDATE SET
             azure_id       = EXCLUDED.azure_id,
             nombre         = EXCLUDED.nombre,
             cargo          = COALESCE(EXCLUDED.cargo, usuarios.cargo),
             actualizado_en = NOW()
         RETURNING id`,
        [azureId, email, nombre, cargo || null]
    );
    return result.rows[0]?.id || null;
}

// ─── RUTAS PARA PANEL DE ADMINISTRADOR ───────────────────────
const ALLOWED_SCREEN_KEYS = new Set([
    'Supervisor',
    'Gerente',
    'Juridica',
    'Financiera',
    'Administrador',
    'SecretariaComite',
    'Riesgos'
]);

async function getUserScreenPermissionsMap() {
    const result = await pool.query(
        'SELECT valor FROM configuracion WHERE clave = $1',
        ['user_screen_permissions_json']
    );

    if (result.rows.length === 0) return {};

    try {
        const parsed = JSON.parse(result.rows[0].valor || '{}');
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (_e) {
        return {};
    }
}

function sanitizeScreenPermissions(value) {
    const arr = Array.isArray(value) ? value : [];
    return Array.from(
        new Set(
            arr
                .map((v) => String(v || '').trim())
                .filter((v) => ALLOWED_SCREEN_KEYS.has(v))
        )
    );
}

async function saveUserScreenPermissionsMap(map) {
    await pool.query(
        `INSERT INTO configuracion (clave, valor, descripcion, actualizado_en)
         VALUES ($1, $2, $3, NOW())
         ON CONFLICT (clave)
         DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
        [
            'user_screen_permissions_json',
            JSON.stringify(map || {}),
            'Permisos por usuario para acceso a pantallas del front'
        ]
    );
}

// GET /api/admin/usuarios
app.get('/api/admin/usuarios', requireRole('administrador'), async (req, res) => {
    try {
        const [usersResult, permissionsMap] = await Promise.all([
            pool.query(
                `SELECT u.*, g.nombre as gerencia_nombre 
             FROM usuarios u
             LEFT JOIN gerencias g ON u.gerencia_id = g.id
             ORDER BY u.nombre`
            ),
            getUserScreenPermissionsMap()
        ]);

        const usersWithPermissions = usersResult.rows.map((u) => {
            const emailKey = String(u.email || '').toLowerCase();
            const permisosRaw = permissionsMap[emailKey];
            return {
                ...u,
                permisos_pantallas: sanitizeScreenPermissions(permisosRaw)
            };
        });

        return res.json(usersWithPermissions);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener usuarios' });
    }
});

// GET /api/admin/permisos-pantallas?email=xxx
// Sin email → devuelve el mapa completo de todos los usuarios (solo administrador).
// Con email → cualquier usuario autenticado puede consultar SUS PROPIOS permisos
// (se usa justo después del login para decidir qué pantallas mostrar); consultar
// los permisos de otro email sigue requiriendo rol administrador.
app.get('/api/admin/permisos-pantallas', async (req, res) => {
    const email = String(req.query.email || '').trim().toLowerCase();
    const esConsultaPropia = email && email === String(req.auth?.email || '').toLowerCase();
    if (!esConsultaPropia && req.auth?.rol !== 'administrador') {
        return res.status(403).json({ error: 'No tiene permisos para esta acción' });
    }
    try {
        const permissionsMap = await getUserScreenPermissionsMap();

        if (!email) {
            // Devolver mapa completo (usado por GestionUsuarios para el merge)
            return res.json({ permisos: permissionsMap });
        }

        const permisos = sanitizeScreenPermissions(permissionsMap[email] || []);
        return res.json({ email, permisos });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al consultar permisos por pantalla' });
    }
});

// PUT /api/admin/permisos-pantallas
app.put('/api/admin/permisos-pantallas', requireRole('administrador'), async (req, res) => {
    const { email, permisos = [] } = req.body || {};
    try {
        const emailKey = String(email || '').trim().toLowerCase();
        if (!emailKey) return res.status(400).json({ error: 'email requerido' });

        const permisosSanitizados = sanitizeScreenPermissions(permisos);
        const permissionsMap = await getUserScreenPermissionsMap();
        const permisosAnteriores = sanitizeScreenPermissions(permissionsMap[emailKey] || []);
        permissionsMap[emailKey] = permisosSanitizados;
        await saveUserScreenPermissionsMap(permissionsMap);

        // El "registro" afectado es el usuario destinatario, no quien ejecuta la acción.
        // Se busca por email porque este endpoint no recibe el id del usuario; si el email
        // todavía no tiene fila en `usuarios` (nunca ha iniciado sesión), se usa un id
        // de relleno fijo en vez de dejarlo vacío.
        const destinatario = await usuarioPorEmail(emailKey);
        const registroIdDestinatario = destinatario?.id || '00000000-0000-0000-0000-000000000002';

        await registrarLog({
            tipo_log: 'seguridad', modulo: 'administracion', tabla: 'permisos_pantallas',
            registro_id: registroIdDestinatario, accion: 'UPDATE',
            campo: 'permisos',
            valor_anterior: permisosAnteriores.join(',') || null,
            valor_nuevo: permisosSanitizados.join(','),
            descripcion: `${req.auth.email} actualizó permisos de pantalla para: ${emailKey}`,
            usuario_id: req.auth.usuarioId, rol_usuario: req.auth.rol,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({
            ok: true,
            email: emailKey,
            permisos: permisosSanitizados
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar permisos de pantalla por email' });
    }
});

// PUT /api/admin/usuarios/:id/permisos-pantallas
app.put('/api/admin/usuarios/:id/permisos-pantallas', requireRole('administrador'), async (req, res) => {
    const { id } = req.params;
    const { permisos = [] } = req.body || {};

    try {
        const userRes = await pool.query(
            'SELECT id, email, nombre FROM usuarios WHERE id = $1::uuid',
            [id]
        );

        if (userRes.rows.length === 0) {
            return res.status(404).json({ error: 'Usuario no encontrado' });
        }

        const user = userRes.rows[0];
        const emailKey = String(user.email || '').toLowerCase();
        const permisosSanitizados = sanitizeScreenPermissions(permisos);

        const permissionsMap = await getUserScreenPermissionsMap();
        const permisosAnteriores = sanitizeScreenPermissions(permissionsMap[emailKey] || []);
        permissionsMap[emailKey] = permisosSanitizados;
        await saveUserScreenPermissionsMap(permissionsMap);

        await registrarLog({
            tipo_log: 'seguridad', modulo: 'administracion', tabla: 'permisos_pantallas',
            registro_id: user.id, accion: 'UPDATE',
            campo: 'permisos',
            valor_anterior: permisosAnteriores.join(',') || null,
            valor_nuevo: permisosSanitizados.join(','),
            descripcion: `${req.auth.email} actualizó permisos de pantalla para: ${emailKey}`,
            usuario_id: req.auth.usuarioId, rol_usuario: req.auth.rol,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({
            ok: true,
            usuario_id: user.id,
            email: user.email,
            nombre: user.nombre,
            permisos: permisosSanitizados
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar permisos de pantalla' });
    }
});

// GET /api/admin/logs/stats — contadores totales por tipo_log para las tarjetas de resumen
app.get('/api/admin/logs/stats', requireRole('administrador'), async (req, res) => {
    try {
        const result = await pool.query(
            `SELECT tipo_log, COUNT(*)::int AS total
             FROM auditoria
             WHERE creado_en >= NOW() - INTERVAL '30 days'
             GROUP BY tipo_log`
        );
        const stats = {};
        result.rows.forEach(r => { stats[r.tipo_log] = r.total; });
        return res.json(stats);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener estadísticas' });
    }
});

// GET /api/admin/logs
// Query params: tipo_log, modulo, accion, fecha_inicio, fecha_fin, busqueda, limit, offset
app.get('/api/admin/logs', requireRole('administrador'), async (req, res) => {
    try {
        const {
            tipo_log, modulo, accion,
            fecha_inicio, fecha_fin,
            busqueda,
            limit: qLimit = '100',
            offset: qOffset = '0'
        } = req.query;

        const params = [];
        const conditions = [];
        let idx = 1;

        if (tipo_log && tipo_log !== 'Todos') {
            conditions.push(`a.tipo_log = $${idx++}`);
            params.push(tipo_log);
        }
        if (modulo && modulo !== 'Todos') {
            conditions.push(`a.modulo = $${idx++}`);
            params.push(modulo);
        }
        if (accion && accion !== 'Todos') {
            conditions.push(`a.accion = $${idx++}`);
            params.push(accion);
        }
        if (fecha_inicio) {
            conditions.push(`a.creado_en >= $${idx++}`);
            params.push(fecha_inicio);
        }
        if (fecha_fin) {
            conditions.push(`a.creado_en <= $${idx++}::date + interval '1 day'`);
            params.push(fecha_fin);
        }
        if (busqueda) {
            conditions.push(`(a.descripcion ILIKE $${idx} OR a.campo ILIKE $${idx} OR a.valor_nuevo ILIKE $${idx} OR u.nombre ILIKE $${idx})`);
            params.push(`%${busqueda}%`);
            idx++;
        }

        const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
        const limitVal = Math.min(parseInt(qLimit) || 100, 500);
        const offsetVal = parseInt(qOffset) || 0;

        const [dataRes, countRes] = await Promise.all([
            pool.query(
                `SELECT a.id, a.tipo_log, a.modulo, a.tabla, a.registro_id,
                        a.accion, a.campo, a.valor_anterior, a.valor_nuevo,
                        a.descripcion, a.rol_usuario, a.resultado,
                        a.usuario_id, u.nombre AS usuario_nombre, u.email AS usuario_email,
                        a.ip_address, a.creado_en
                 FROM auditoria a
                 LEFT JOIN usuarios u ON a.usuario_id = u.id
                 ${where}
                 ORDER BY a.creado_en DESC
                 LIMIT $${idx} OFFSET $${idx + 1}`,
                [...params, limitVal, offsetVal]
            ),
            pool.query(
                `SELECT COUNT(*) AS total FROM auditoria a LEFT JOIN usuarios u ON a.usuario_id = u.id ${where}`,
                params
            )
        ]);

        return res.json({
            logs: dataRes.rows,
            total: parseInt(countRes.rows[0].total),
            limit: limitVal,
            offset: offsetVal
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener logs de auditoría' });
    }
});

// GET /api/admin/configuracion
app.get('/api/admin/configuracion', requireRole('administrador'), async (req, res) => {
    try {
        const result = await pool.query('SELECT * FROM configuracion ORDER BY clave');
        const config = {};
        result.rows.forEach(row => {
            config[row.clave] = row.valor;
        });
        return res.json(config);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener configuración' });
    }
});

// POST /api/admin/configuracion
app.post('/api/admin/configuracion', requireRole('administrador'), async (req, res) => {
    const config = req.body; // { clave: valor, ... }
    // _usuario_id/_usuario_email ya no se toman del body (el cliente podía
    // autodeclarar cualquier valor); el actor real viene del token verificado.
    const { _usuario_id, _usuario_email, ...claves } = config;
    try {
        for (const [clave, valor] of Object.entries(claves)) {
            const prev = await pool.query('SELECT valor FROM configuracion WHERE clave = $1', [clave]);
            const valorAnterior = prev.rows[0]?.valor ?? null;
            await pool.query(
                `INSERT INTO configuracion (clave, valor)
                 VALUES ($1, $2)
                 ON CONFLICT (clave) DO UPDATE SET valor = EXCLUDED.valor, actualizado_en = NOW()`,
                [clave, valor.toString()]
            );
            await registrarLog({
                tipo_log: 'configuracion', modulo: 'administracion', tabla: 'configuracion',
                registro_id: '00000000-0000-0000-0000-000000000001', accion: 'UPDATE',
                campo: clave, valor_anterior: valorAnterior, valor_nuevo: valor.toString(),
                descripcion: `${req.auth.email} cambió parámetro de configuración: ${clave}`,
                usuario_id: req.auth.usuarioId, rol_usuario: req.auth.rol,
                ip_address: getClientIp(req), resultado: 'exitoso'
            });
        }
        return res.json({ success: true, message: 'Configuración actualizada' });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar configuración' });
    }
});

// ═══════════════════════════════════════════════════════════════
//  SISTEMA DE CONVOCATORIAS A PROPONENTES
//  Jurídica crea una convocatoria → genera token por proponente
//  → proponente abre enlace → responde antes de la fecha límite
// ═══════════════════════════════════════════════════════════════

async function ensureConvocatoriasStorage() {
    // Tabla principal de convocatorias
    await pool.query(`
        CREATE TABLE IF NOT EXISTS convocatorias (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            solicitud_id UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
            asunto TEXT NOT NULL,
            descripcion_requisitos TEXT NOT NULL DEFAULT '',
            fecha_inicio TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            fecha_limite TIMESTAMPTZ NOT NULL,
            creada_por TEXT,
            estado TEXT NOT NULL DEFAULT 'abierta',
            creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Tabla de invitaciones (una por proponente por convocatoria)
    await pool.query(`
        CREATE TABLE IF NOT EXISTS convocatoria_invitaciones (
            id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
            convocatoria_id UUID NOT NULL REFERENCES convocatorias(id) ON DELETE CASCADE,
            proponente_email TEXT NOT NULL,
            proponente_nombre TEXT NOT NULL DEFAULT '',
            token TEXT NOT NULL UNIQUE,
            respondida BOOLEAN NOT NULL DEFAULT FALSE,
            respuesta_texto TEXT,
            respuesta_archivos JSONB DEFAULT '[]'::jsonb,
            respondida_en TIMESTAMPTZ,
            creado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    // Columnas de auditoría y rastreo (migración segura — se agregan si no existen)
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS primer_acceso_en TIMESTAMPTZ`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS ip_acceso TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS total_accesos INTEGER NOT NULL DEFAULT 0`);

    // Columna para distinguir postulaciones públicas (Computrabajo, etc.) de invitaciones directas
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS es_postulacion_publica BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS telefono TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS link_enviado_en TIMESTAMPTZ`);

    // Columna en convocatorias para saber si el link público está habilitado
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS link_publico_activo BOOLEAN NOT NULL DEFAULT FALSE`);
    // FASE 1: fecha límite para REGISTRARSE en el link público (Computrabajo)
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS fecha_limite_registro TIMESTAMPTZ`);
    // Descripción corta y amigable para el link público (Computrabajo, portales externos)
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS descripcion_publica TEXT NOT NULL DEFAULT ''`);
    // FASE 2: si ya se envió la invitación formal a ofertar y cuándo
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS fase_invitacion_enviada BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS invitacion_enviada_en TIMESTAMPTZ`);
    // FASE 1 email: si ya se notificó a proponentes conocidos con el link público y cuándo
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS fase1_notificacion_enviada BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS fase1_notificacion_enviada_en TIMESTAMPTZ`);
    // Tipo de proponente esperado en registro público: 'empresa' (default) o 'persona'
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS tipo_proponente TEXT NOT NULL DEFAULT 'empresa'`);
    // Tipo de objeto contractual: 'bienes_servicios' (default) o 'servicios_profesionales' —
    // determina qué documentos adicionales debe cargar el proponente en el RA1-4 (checklist oficial)
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS tipo_objeto TEXT NOT NULL DEFAULT 'bienes_servicios'`);
    // Documento adjunto para la Fase 2 (PDF, DOCX, etc.) — URL relativa al servidor
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS documento_adjunto_url TEXT`);
    await pool.query(`ALTER TABLE convocatorias ADD COLUMN IF NOT EXISTS documento_adjunto_nombre TEXT`);
    // Cédula o NIT del proponente registrado públicamente
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS cedula_nit TEXT`);
    // Teléfono del proponente registrado públicamente
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS telefono TEXT`);
    // Aceptación de la política de tratamiento de datos personales (Ley 1581 de 2012 - Habeas Data)
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS acepta_tratamiento_datos BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS acepta_tratamiento_datos_en TIMESTAMPTZ`);
    // Tipo de proponente registrado ('persona' | 'empresa') — solo aplica a registros vía link público
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS tipo_persona TEXT`);

    // ── Campos del formulario RA1-4 (Creación o actualización de proveedores) ──
    // Identificación
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS tipo_documento TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS domicilio TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS pagina_web TEXT`);
    // Representación legal (empresas)
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS representante_legal_nombre TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS representante_legal_tipo_id TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS representante_legal_identificacion TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS representante_legal_direccion TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS representante_legal_autorizado TEXT`);
    // Datos tributarios
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS ciiu TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS tarifa TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS regimen TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS actividad_economica TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS municipio_inscripcion TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS es_gran_contribuyente BOOLEAN`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS gran_contribuyente_resolucion TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS gran_contribuyente_fecha DATE`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS es_auto_retenedor BOOLEAN`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS auto_retenedor_resolucion TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS auto_retenedor_fecha DATE`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS es_entidad_estado BOOLEAN`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS exento_impuesto_renta BOOLEAN`);
    // Tesorería
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS banco TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS banco_sucursal TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS banco_email_contacto TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS tipo_cuenta TEXT`);
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS numero_cuenta TEXT`);
    // Documentos adjuntos del proveedor (ver DOCUMENTOS_PROVEEDOR_CAMPOS)
    await pool.query(`ALTER TABLE convocatoria_invitaciones ADD COLUMN IF NOT EXISTS documentos_proveedor JSONB NOT NULL DEFAULT '[]'::jsonb`);
}

// POST /api/convocatorias/upload-documento
// Sube un documento adjunto para la Fase 2 (TDR, ficha técnica, etc.)
app.post('/api/convocatorias/upload-documento', upload.single('documento'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });
    const url = `/api/uploads/convocatorias/${req.file.filename}`;
    return res.json({ url, nombre: req.file.originalname, size: req.file.size });
});

// Genera un token de 48 bytes criptográficamente seguro (base64url, 64 chars)
// Usa crypto.randomBytes() — NUNCA Math.random() que es predecible
function generarToken() {
    return crypto.randomBytes(48).toString('base64url');
}

// POST /api/convocatorias
// Jurídica crea una convocatoria. Activa el link público de registro (Fase 1) inmediatamente.
// Los correos de invitación formal (Fase 2) se envían por separado con /enviar-invitacion-masiva.
app.post('/api/convocatorias', async (req, res) => {
    const {
        solicitud_id,
        asunto,
        descripcion_publica,        // Descripción breve para el link público (Computrabajo) — requerido
        descripcion_requisitos,
        fecha_inicio,
        fecha_limite,
        fecha_limite_registro,
        proponentes,
        creada_por,
        tipo_proponente,            // 'empresa' (default) o 'persona'
        tipo_objeto,                // 'bienes_servicios' (default) o 'servicios_profesionales'
        documento_adjunto_url,      // URL del documento adjunto para Fase 2
        documento_adjunto_nombre
    } = req.body;

    if (!solicitud_id || !asunto || !fecha_limite_registro || !descripcion_publica) {
        return res.status(400).json({
            error: 'Se requiere: solicitud_id, asunto, descripcion_publica y fecha_limite_registro'
        });
    }

    const props = Array.isArray(proponentes) ? proponentes : [];

    const client = await pool.connect();
    try {
        await ensureConvocatoriasStorage();
        await client.query('BEGIN');

        const convRes = await client.query(
            `INSERT INTO convocatorias
                (solicitud_id, asunto, descripcion_publica, descripcion_requisitos, fecha_inicio, fecha_limite,
                 fecha_limite_registro, creada_por, link_publico_activo, tipo_proponente, tipo_objeto, documento_adjunto_url, documento_adjunto_nombre)
             VALUES ($1::uuid, $2, $3, $4, $5, $6, $7, $8, FALSE, $9, $10, $11, $12)
             RETURNING *`,
            [
                solicitud_id, asunto, descripcion_publica, descripcion_requisitos || '',
                fecha_inicio || new Date().toISOString(), fecha_limite || null, fecha_limite_registro,
                creada_por || null, tipo_proponente || 'empresa', tipo_objeto || 'bienes_servicios',
                documento_adjunto_url || null, documento_adjunto_nombre || null
            ]
        );
        const convocatoria = convRes.rows[0];

        // Crear tokens para proponentes conocidos sin enviar correos (los correos van en Fase 2)
        for (const p of props) {
            if (!p.email) continue;
            const token = generarToken();
            await client.query(
                `INSERT INTO convocatoria_invitaciones (convocatoria_id, proponente_email, proponente_nombre, token)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT DO NOTHING`,
                [convocatoria.id, p.email.toLowerCase().trim(), p.nombre || '', token]
            ).catch(() => { }); // ignorar duplicados
        }

        await client.query('COMMIT');

        // Log creación de convocatoria vinculado a la solicitud
        const uConv = creada_por ? await usuarioPorEmail(creada_por) : null;
        await registrarLog({
            tipo_log: 'negocio', modulo: 'juridica', tabla: 'solicitudes',
            registro_id: solicitud_id, accion: 'CONVOCATORIA_CREADA',
            descripcion: `Convocatoria creada: "${asunto}"`,
            usuario_id: uConv?.id || null, rol_usuario: uConv?.rol || null
        });

        return res.status(201).json({
            ok: true,
            convocatoria,
            mensaje: `Convocatoria creada. Link público activo. Registro abierto hasta ${new Date(fecha_limite_registro).toLocaleString('es-CO')}.`,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error creando convocatoria:', err);
        return res.status(500).json({ error: 'Error al crear la convocatoria' });
    } finally {
        client.release();
    }
});

// GET /api/convocatorias?solicitud_id=xxx
// Listar convocatorias de una solicitud
app.get('/api/convocatorias', async (req, res) => {
    const { solicitud_id } = req.query;
    try {
        await ensureConvocatoriasStorage();

        let query = `SELECT c.*, 
                        (SELECT COUNT(*) FROM convocatoria_invitaciones ci WHERE ci.convocatoria_id = c.id) as total_invitados,
                        (SELECT COUNT(*) FROM convocatoria_invitaciones ci WHERE ci.convocatoria_id = c.id AND ci.respondida = TRUE) as total_respondidos
                     FROM convocatorias c`;
        const params = [];

        if (solicitud_id) {
            query += ` WHERE c.solicitud_id = $1::uuid`;
            params.push(solicitud_id);
        }
        query += ` ORDER BY c.creado_en DESC`;

        const result = await pool.query(query, params);
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al listar convocatorias' });
    }
});

// PATCH /api/convocatorias/:id
// Actualiza campos editables de la convocatoria (solo antes de enviar Fase 2)
app.patch('/api/convocatorias/:id', async (req, res) => {
    const { id } = req.params;
    const { descripcion_requisitos, fecha_limite, documento_adjunto_url, documento_adjunto_nombre } = req.body;
    try {
        await ensureConvocatoriasStorage();
        const convRes = await pool.query(`SELECT fase_invitacion_enviada FROM convocatorias WHERE id = $1::uuid`, [id]);
        if (convRes.rows.length === 0) return res.status(404).json({ error: 'Convocatoria no encontrada.' });
        if (convRes.rows[0].fase_invitacion_enviada) {
            // Después de Fase 2 solo se permite ampliar el plazo de propuesta (fecha_limite)
            const intentaEditarOtros = descripcion_requisitos !== undefined || documento_adjunto_url !== undefined || documento_adjunto_nombre !== undefined;
            if (intentaEditarOtros || fecha_limite === undefined) {
                return res.status(409).json({ error: 'No se puede editar una convocatoria con Fase 2 ya enviada.' });
            }
        }
        const updates = [];
        const params = [];
        if (descripcion_requisitos !== undefined) { params.push(descripcion_requisitos); updates.push(`descripcion_requisitos = $${params.length}`); }
        if (fecha_limite !== undefined) { params.push(fecha_limite); updates.push(`fecha_limite = $${params.length}`); }
        if (documento_adjunto_url !== undefined) { params.push(documento_adjunto_url); updates.push(`documento_adjunto_url = $${params.length}`); }
        if (documento_adjunto_nombre !== undefined) { params.push(documento_adjunto_nombre); updates.push(`documento_adjunto_nombre = $${params.length}`); }
        if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar.' });
        params.push(id);
        await pool.query(`UPDATE convocatorias SET ${updates.join(', ')} WHERE id = $${params.length}::uuid`, params);
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error actualizando convocatoria:', err);
        return res.status(500).json({ error: 'Error al actualizar la convocatoria.' });
    }
});

// GET /api/convocatorias/:id
// Detalle de una convocatoria con sus invitaciones
app.get('/api/convocatorias/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await ensureConvocatoriasStorage();

        const convRes = await pool.query(`SELECT * FROM convocatorias WHERE id = $1::uuid`, [id]);
        if (convRes.rows.length === 0) return res.status(404).json({ error: 'Convocatoria no encontrada' });

        const invRes = await pool.query(
            `SELECT id, proponente_email, proponente_nombre, token, respondida, respondida_en,
                    respuesta_texto, respuesta_archivos,
                    primer_acceso_en, ip_acceso, total_accesos,
                    es_postulacion_publica, telefono, link_enviado_en,
                    cedula_nit, acepta_tratamiento_datos, acepta_tratamiento_datos_en, creado_en,
                    tipo_persona
             FROM convocatoria_invitaciones
             WHERE convocatoria_id = $1::uuid
             ORDER BY creado_en ASC`,
            [id]
        );

        return res.json({
            convocatoria: convRes.rows[0],
            invitaciones: invRes.rows
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener convocatoria' });
    }
});

// ─── RUTAS PÚBLICAS PARA PROPONENTES (sin autenticación) ─────

// GET /api/proponente/convocatoria?token=xxx
// El proponente abre su enlace → ve la convocatoria y si aún puede responder
app.get('/api/proponente/convocatoria', proponenteRateLimit, async (req, res) => {
    const { token } = req.query;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    try {
        await ensureConvocatoriasStorage();

        const invRes = await pool.query(
            `SELECT ci.*, c.asunto, c.descripcion_requisitos, c.fecha_inicio, c.fecha_limite, c.estado as conv_estado,
                    c.documento_adjunto_url, c.documento_adjunto_nombre, c.tipo_objeto,
                    s.codigo as solicitud_codigo, s.objeto as solicitud_objeto
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             LEFT JOIN solicitudes s ON c.solicitud_id = s.id
             WHERE ci.token = $1`,
            [token]
        );

        if (invRes.rows.length === 0) {
            return res.status(404).json({ error: 'Enlace inválido o expirado' });
        }

        const inv = invRes.rows[0];
        const ahora = new Date();
        const fechaLimite = new Date(inv.fecha_limite);
        const vencida = ahora > fechaLimite;

        // Registrar primer acceso e incrementar contador (sin bloquear la respuesta)
        const ip = getClientIp(req);
        pool.query(
            `UPDATE convocatoria_invitaciones
             SET primer_acceso_en = COALESCE(primer_acceso_en, NOW()),
                 ip_acceso        = COALESCE(ip_acceso, $2),
                 total_accesos    = total_accesos + 1
             WHERE id = $1::uuid`,
            [inv.id, ip]
        ).catch(e => console.error('Error registrando acceso proponente:', e));

        return res.json({
            invitacion_id: inv.id,
            proponente_nombre: inv.proponente_nombre,
            proponente_email: inv.proponente_email,
            asunto: inv.asunto,
            descripcion_requisitos: inv.descripcion_requisitos,
            fecha_inicio: inv.fecha_inicio,
            fecha_limite: inv.fecha_limite,
            solicitud_codigo: inv.solicitud_codigo,
            solicitud_objeto: inv.solicitud_objeto,
            tipo_objeto: inv.tipo_objeto || 'bienes_servicios',
            tipo_persona: inv.tipo_persona || 'empresa',
            documento_adjunto_url: inv.documento_adjunto_url || null,
            documento_adjunto_nombre: inv.documento_adjunto_nombre || null,
            ya_respondida: inv.respondida,
            respuesta_texto: inv.respuesta_texto || null,
            respuesta_archivos: inv.respuesta_archivos || [],
            documentos_proveedor: inv.documentos_proveedor || [],
            respondida_en: inv.respondida_en || null,
            primer_acceso_en: inv.primer_acceso_en || null,
            vencida,
            puede_responder: !vencida && !inv.respondida,
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al consultar convocatoria del proponente' });
    }
});

// POST /api/proponente/responder
// El proponente envía su respuesta (solo si no ha pasado la fecha límite)
app.post('/api/proponente/responder', proponenteRateLimit, async (req, res) => {
    const {
        token, respuesta_texto, archivos,
        banco, banco_sucursal, banco_email_contacto, tipo_cuenta, numero_cuenta,
    } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });

    // ── Datos de tesorería del formulario RA1-4 (obligatorios en Fase 2) ──
    const camposTesoreria = {
        'Banco': banco, 'Sucursal': banco_sucursal, 'Dirección correo persona contacto': banco_email_contacto,
        'Tipo de cuenta': tipo_cuenta, 'Número de cuenta': numero_cuenta,
    };
    for (const [label, valor] of Object.entries(camposTesoreria)) {
        if (!valor || !String(valor).trim()) return res.status(400).json({ error: `El campo "${label}" es obligatorio.` });
    }

    try {
        await ensureConvocatoriasStorage();

        // Verificar invitación
        const invRes = await pool.query(
            `SELECT ci.*, c.fecha_limite, c.estado as conv_estado, c.tipo_objeto
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE ci.token = $1`,
            [token]
        );

        if (invRes.rows.length === 0) {
            return res.status(404).json({ error: 'Enlace inválido o expirado' });
        }

        const inv = invRes.rows[0];

        // Verificar si ya respondió
        if (inv.respondida) {
            return res.status(409).json({ error: 'Ya enviaste tu respuesta anteriormente. No se puede modificar.' });
        }

        // Verificar fecha límite
        const ahora = new Date();
        const fechaLimite = new Date(inv.fecha_limite);
        if (ahora > fechaLimite) {
            return res.status(403).json({
                error: 'El plazo para responder ha vencido. No se aceptan más respuestas.',
                fecha_limite: inv.fecha_limite
            });
        }

        // Verificar que los documentos del formulario RA1-4 ya fueron subidos.
        // Camara de comercio solo aplica a personas jurídicas; los 3 documentos de
        // "servicios profesionales" solo se exigen para esa modalidad.
        const documentosProveedor = Array.isArray(inv.documentos_proveedor) ? inv.documentos_proveedor : [];
        const camposRequeridos = camposDocumentosRequeridos(inv.tipo_persona, inv.tipo_objeto);
        for (const campo of camposRequeridos) {
            if (!documentosProveedor.some(d => d.tipo === campo)) {
                return res.status(400).json({ error: `Debes adjuntar el documento: ${DOCUMENTOS_PROVEEDOR_LABELS[campo]}.` });
            }
        }

        // Combinar archivos subidos previamente con los del body
        const archivosExistentes = Array.isArray(inv.respuesta_archivos) ? inv.respuesta_archivos : [];
        const archivosNuevos = Array.isArray(archivos) ? archivos : [];
        const todosArchivos = [...archivosExistentes, ...archivosNuevos];

        // Guardar respuesta
        await pool.query(
            `UPDATE convocatoria_invitaciones
             SET respondida = TRUE,
                 respuesta_texto = $2,
                 respuesta_archivos = $3::jsonb,
                 respondida_en = NOW(),
                 banco = $4, banco_sucursal = $5, banco_email_contacto = $6,
                 tipo_cuenta = $7, numero_cuenta = $8
             WHERE id = $1::uuid`,
            [
                inv.id,
                respuesta_texto || '',
                JSON.stringify(todosArchivos),
                banco.trim(), banco_sucursal.trim(), banco_email_contacto.trim(), tipo_cuenta.trim(), numero_cuenta.trim(),
            ]
        );

        return res.json({
            ok: true,
            mensaje: 'Respuesta enviada exitosamente. Gracias por participar.'
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al guardar respuesta' });
    }
});

// POST /api/proponente/subir-archivo
// Sube un archivo asociado a una invitación (valida token y plazo)
app.post('/api/proponente/subir-archivo', proponenteRateLimit, (req, res, next) => {
    upload.single('archivo')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: 'Error al subir archivo: ' + err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    const { token } = req.body;
    if (!token) return res.status(400).json({ error: 'Token requerido' });
    if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });

    try {
        await ensureConvocatoriasStorage();

        const invRes = await pool.query(
            `SELECT ci.*, c.fecha_limite
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE ci.token = $1`,
            [token]
        );

        if (invRes.rows.length === 0) {
            fs.unlinkSync(req.file.path); // Limpiar archivo huérfano
            return res.status(404).json({ error: 'Enlace inválido' });
        }

        const inv = invRes.rows[0];

        // Verificar plazo
        if (new Date() > new Date(inv.fecha_limite)) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: 'El plazo ha vencido. No se aceptan archivos.' });
        }

        // Verificar si ya respondió
        if (inv.respondida) {
            fs.unlinkSync(req.file.path);
            return res.status(409).json({ error: 'Ya enviaste tu respuesta. No se pueden agregar más archivos.' });
        }

        // Registrar archivo en el JSON de la invitación
        const archivos = Array.isArray(inv.respuesta_archivos) ? inv.respuesta_archivos : [];
        const nuevoArchivo = {
            id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
            nombre: req.file.originalname,
            nombre_almacenado: req.file.filename,
            tamano: req.file.size,
            tipo: req.file.mimetype,
            url: `/api/uploads/convocatorias/${req.file.filename}`,
            subido_en: new Date().toISOString()
        };
        archivos.push(nuevoArchivo);

        await pool.query(
            `UPDATE convocatoria_invitaciones
             SET respuesta_archivos = $2::jsonb
             WHERE id = $1::uuid`,
            [inv.id, JSON.stringify(archivos)]
        );

        await registrarLog({
            tipo_log: 'acceso', modulo: 'proponentes', tabla: 'convocatoria_invitaciones',
            registro_id: inv.id, accion: 'INSERT',
            descripcion: `Proponente ${inv.proponente_email || 'desconocido'} subió el archivo "${nuevoArchivo.nombre}"`,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.status(201).json(nuevoArchivo);
    } catch (err) {
        console.error(err);
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: 'Error al subir archivo' });
    }
});

// DELETE /api/proponente/eliminar-archivo
// Elimina un archivo subido (solo si no ha respondido y no ha pasado la fecha)
app.delete('/api/proponente/eliminar-archivo', proponenteRateLimit, async (req, res) => {
    const { token, archivo_id } = req.body;
    if (!token || !archivo_id) return res.status(400).json({ error: 'Token y archivo_id requeridos' });

    try {
        await ensureConvocatoriasStorage();

        const invRes = await pool.query(
            `SELECT ci.*, c.fecha_limite
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE ci.token = $1`,
            [token]
        );

        if (invRes.rows.length === 0) return res.status(404).json({ error: 'Enlace inválido' });

        const inv = invRes.rows[0];
        if (inv.respondida) return res.status(409).json({ error: 'No se pueden eliminar archivos después de responder.' });
        if (new Date() > new Date(inv.fecha_limite)) return res.status(403).json({ error: 'Plazo vencido.' });

        const archivos = Array.isArray(inv.respuesta_archivos) ? inv.respuesta_archivos : [];
        const archivoEliminar = archivos.find(a => a.id === archivo_id);

        // Eliminar archivo físico
        if (archivoEliminar?.nombre_almacenado) {
            const filePath = path.join(UPLOADS_DIR, archivoEliminar.nombre_almacenado);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        const actualizados = archivos.filter(a => a.id !== archivo_id);
        await pool.query(
            `UPDATE convocatoria_invitaciones SET respuesta_archivos = $2::jsonb WHERE id = $1::uuid`,
            [inv.id, JSON.stringify(actualizados)]
        );

        await registrarLog({
            tipo_log: 'acceso', modulo: 'proponentes', tabla: 'convocatoria_invitaciones',
            registro_id: inv.id, accion: 'DELETE',
            descripcion: `Proponente ${inv.proponente_email || 'desconocido'} eliminó el archivo "${archivoEliminar?.nombre || archivo_id}"`,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al eliminar archivo' });
    }
});

// POST /api/proponente/subir-documento-ra14
// Sube (o reemplaza) uno de los 5 documentos del formulario RA1-4 en la Fase 2.
app.post('/api/proponente/subir-documento-ra14', proponenteRateLimit, (req, res, next) => {
    uploadProveedores.single('archivo')(req, res, function (err) {
        if (err instanceof multer.MulterError) {
            return res.status(400).json({ error: 'Error al subir archivo: ' + err.message });
        } else if (err) {
            return res.status(400).json({ error: err.message });
        }
        next();
    });
}, async (req, res) => {
    const { token, tipo } = req.body;
    if (!token) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Token requerido' }); }
    if (![...DOCUMENTOS_PROVEEDOR_CAMPOS, ...DOCUMENTOS_PROVEEDOR_CAMPOS_SERVICIOS_PROFESIONALES].includes(tipo)) { if (req.file) fs.unlinkSync(req.file.path); return res.status(400).json({ error: 'Tipo de documento no válido' }); }
    if (!req.file) return res.status(400).json({ error: 'No se envió ningún archivo' });

    try {
        await ensureConvocatoriasStorage();

        const invRes = await pool.query(
            `SELECT ci.*, c.fecha_limite
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE ci.token = $1`,
            [token]
        );

        if (invRes.rows.length === 0) {
            fs.unlinkSync(req.file.path);
            return res.status(404).json({ error: 'Enlace inválido' });
        }

        const inv = invRes.rows[0];

        if (new Date() > new Date(inv.fecha_limite)) {
            fs.unlinkSync(req.file.path);
            return res.status(403).json({ error: 'El plazo ha vencido. No se aceptan archivos.' });
        }
        if (inv.respondida) {
            fs.unlinkSync(req.file.path);
            return res.status(409).json({ error: 'Ya enviaste tu respuesta. No se pueden agregar más archivos.' });
        }

        const documentos = Array.isArray(inv.documentos_proveedor) ? inv.documentos_proveedor : [];
        const anterior = documentos.find(d => d.tipo === tipo);
        if (anterior?.nombre_almacenado) {
            const rutaAnterior = path.join(PROVEEDORES_UPLOADS_DIR, anterior.nombre_almacenado);
            if (fs.existsSync(rutaAnterior)) fs.unlinkSync(rutaAnterior);
        }

        const nuevoDocumento = {
            tipo,
            nombre: req.file.originalname,
            nombre_almacenado: req.file.filename,
            tamano: req.file.size,
            mimetype: req.file.mimetype,
            url: `/api/uploads/proveedores/${req.file.filename}`,
            subido_en: new Date().toISOString(),
        };
        const documentosActualizados = [...documentos.filter(d => d.tipo !== tipo), nuevoDocumento];

        await pool.query(
            `UPDATE convocatoria_invitaciones SET documentos_proveedor = $2::jsonb WHERE id = $1::uuid`,
            [inv.id, JSON.stringify(documentosActualizados)]
        );

        // Documento con datos personales/tributarios (cédula, certificación
        // bancaria, etc.) — se audita el acceso por trazabilidad (Ley 1581/2012).
        await registrarLog({
            tipo_log: 'acceso', modulo: 'proponentes', tabla: 'convocatoria_invitaciones',
            registro_id: inv.id, accion: 'INSERT', campo: tipo,
            descripcion: `Proponente ${inv.proponente_email || 'desconocido'} subió el documento "${DOCUMENTOS_PROVEEDOR_LABELS[tipo] || tipo}"`,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.status(201).json(nuevoDocumento);
    } catch (err) {
        console.error(err);
        if (req.file) fs.unlinkSync(req.file.path);
        return res.status(500).json({ error: 'Error al subir el documento' });
    }
});

// DELETE /api/proponente/eliminar-documento-ra14
// Quita uno de los documentos del formulario RA1-4 (solo si no ha respondido y no ha vencido el plazo)
app.delete('/api/proponente/eliminar-documento-ra14', proponenteRateLimit, async (req, res) => {
    const { token, tipo } = req.body;
    if (!token || !tipo) return res.status(400).json({ error: 'Token y tipo requeridos' });

    try {
        await ensureConvocatoriasStorage();

        const invRes = await pool.query(
            `SELECT ci.*, c.fecha_limite
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             WHERE ci.token = $1`,
            [token]
        );

        if (invRes.rows.length === 0) return res.status(404).json({ error: 'Enlace inválido' });

        const inv = invRes.rows[0];
        if (inv.respondida) return res.status(409).json({ error: 'No se pueden eliminar documentos después de responder.' });
        if (new Date() > new Date(inv.fecha_limite)) return res.status(403).json({ error: 'Plazo vencido.' });

        const documentos = Array.isArray(inv.documentos_proveedor) ? inv.documentos_proveedor : [];
        const documentoEliminar = documentos.find(d => d.tipo === tipo);

        if (documentoEliminar?.nombre_almacenado) {
            const filePath = path.join(PROVEEDORES_UPLOADS_DIR, documentoEliminar.nombre_almacenado);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        const actualizados = documentos.filter(d => d.tipo !== tipo);
        await pool.query(
            `UPDATE convocatoria_invitaciones SET documentos_proveedor = $2::jsonb WHERE id = $1::uuid`,
            [inv.id, JSON.stringify(actualizados)]
        );

        await registrarLog({
            tipo_log: 'acceso', modulo: 'proponentes', tabla: 'convocatoria_invitaciones',
            registro_id: inv.id, accion: 'DELETE', campo: tipo,
            descripcion: `Proponente ${inv.proponente_email || 'desconocido'} eliminó el documento "${DOCUMENTOS_PROVEEDOR_LABELS[tipo] || tipo}"`,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({ ok: true });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al eliminar el documento' });
    }
});

// ─── RUTA: Health check ───────────────────────────────────────
app.get('/api/health', async (_, res) => {
    try {
        await pool.query('SELECT 1');
        res.json({ status: 'ok', db: 'connected', timestamp: new Date() });
    } catch {
        res.status(503).json({ status: 'error', db: 'disconnected' });
    }
});

// ═══════════════════════════════════════════════════════════════
//  CONVOCATORIA PÚBLICA (Computrabajo, portales externos, etc.)
//  Un solo link por convocatoria → cualquier persona puede postularse
//  sin tener cuenta en el sistema.
// ═══════════════════════════════════════════════════════════════

// GET /api/proveedores/buscar-por-documento?documento=...&tipo_persona=empresa|persona
// Busca el registro RA1-4 (Fase 1) más reciente con ese número de documento, para
// autocompletar el formulario de registro público a quien ya se ha registrado antes
// en otra convocatoria. No requiere autenticación (dato público de postulación).
app.get('/api/proveedores/buscar-por-documento', proponenteRateLimit, async (req, res) => {
    const { documento, tipo_persona } = req.query;
    if (!documento || !String(documento).trim()) return res.status(400).json({ error: 'Documento requerido' });
    if (tipo_persona !== 'empresa' && tipo_persona !== 'persona') return res.status(400).json({ error: 'tipo_persona inválido' });

    try {
        await ensureConvocatoriasStorage();
        const result = await pool.query(
            `SELECT id, proponente_nombre, proponente_email, telefono, cedula_nit,
                    tipo_documento, domicilio, pagina_web,
                    representante_legal_nombre, representante_legal_tipo_id, representante_legal_identificacion,
                    representante_legal_direccion, representante_legal_autorizado,
                    ciiu, tarifa, regimen, actividad_economica, municipio_inscripcion,
                    es_gran_contribuyente, gran_contribuyente_resolucion, gran_contribuyente_fecha,
                    es_auto_retenedor, auto_retenedor_resolucion, auto_retenedor_fecha,
                    es_entidad_estado, exento_impuesto_renta
             FROM convocatoria_invitaciones
             WHERE cedula_nit = $1 AND tipo_persona = $2 AND tipo_documento IS NOT NULL
             ORDER BY creado_en DESC
             LIMIT 1`,
            [String(documento).trim(), tipo_persona]
        );

        if (result.rows.length === 0) return res.status(404).json({ encontrado: false });

        const r = result.rows[0];

        // Consulta pública de datos personales/tributarios por número de documento
        // — se audita el acceso por trazabilidad (Ley 1581/2012).
        await registrarLog({
            tipo_log: 'acceso', modulo: 'proponentes', tabla: 'convocatoria_invitaciones',
            registro_id: r.id, accion: 'SELECT',
            descripcion: `Consulta pública de datos de proveedor por documento (${tipo_persona}): ${String(documento).trim()}`,
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({
            encontrado: true,
            nombre: r.proponente_nombre,
            email: r.proponente_email,
            telefono: r.telefono,
            tipo_documento: r.tipo_documento,
            domicilio: r.domicilio,
            pagina_web: r.pagina_web,
            representante_legal_nombre: r.representante_legal_nombre,
            representante_legal_tipo_id: r.representante_legal_tipo_id,
            representante_legal_identificacion: r.representante_legal_identificacion,
            representante_legal_direccion: r.representante_legal_direccion,
            representante_legal_autorizado: r.representante_legal_autorizado,
            ciiu: r.ciiu,
            tarifa: r.tarifa,
            regimen: r.regimen,
            actividad_economica: r.actividad_economica,
            municipio_inscripcion: r.municipio_inscripcion,
            es_gran_contribuyente: r.es_gran_contribuyente,
            gran_contribuyente_resolucion: r.gran_contribuyente_resolucion,
            gran_contribuyente_fecha: r.gran_contribuyente_fecha,
            es_auto_retenedor: r.es_auto_retenedor,
            auto_retenedor_resolucion: r.auto_retenedor_resolucion,
            auto_retenedor_fecha: r.auto_retenedor_fecha,
            es_entidad_estado: r.es_entidad_estado,
            exento_impuesto_renta: r.exento_impuesto_renta,
        });
    } catch (err) {
        console.error('Error buscando proveedor por documento:', err);
        return res.status(500).json({ error: 'Error al buscar el proveedor' });
    }
});

// GET /api/convocatoria-publica/:convocatoria_id
// Retorna la info pública de la convocatoria si el link está activo y no ha vencido.
// No requiere autenticación.
app.get('/api/convocatoria-publica/:id', proponenteRateLimit, async (req, res) => {
    const { id } = req.params;
    try {
        await ensureConvocatoriasStorage();
        const result = await pool.query(
            `SELECT c.id, c.asunto, c.descripcion_publica, c.descripcion_requisitos, c.fecha_inicio, c.fecha_limite,
                    c.fecha_limite_registro, c.link_publico_activo, c.fase_invitacion_enviada,
                    c.tipo_proponente,
                    s.codigo as solicitud_codigo, s.objeto as solicitud_objeto
             FROM convocatorias c
             LEFT JOIN solicitudes s ON c.solicitud_id = s.id
             WHERE c.id = $1::uuid`,
            [id]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Convocatoria no encontrada.' });
        }
        const conv = result.rows[0];
        const fechaLimiteReg = conv.fecha_limite_registro || conv.fecha_limite;
        // Si el link está inactivo, devolvemos 200 con vencida=true y la razón de cierre
        // para que el frontend pueda mostrar un mensaje específico
        if (!conv.link_publico_activo) {
            return res.json({
                id: conv.id,
                asunto: conv.asunto,
                descripcion_publica: conv.descripcion_publica || '',
                descripcion_requisitos: conv.descripcion_requisitos || '',
                fecha_inicio: conv.fecha_inicio,
                fecha_limite: fechaLimiteReg,
                solicitud_codigo: conv.solicitud_codigo,
                solicitud_objeto: conv.solicitud_objeto,
                tipo_proponente: conv.tipo_proponente || 'empresa',
                vencida: true,
                puede_postular: false,
                razon_cierre: conv.fase_invitacion_enviada ? 'invitacion_enviada' : 'link_inactivo',
            });
        }
        const vencida = new Date() > new Date(fechaLimiteReg) || !!conv.fase_invitacion_enviada;
        return res.json({
            id: conv.id,
            asunto: conv.asunto,
            descripcion_publica: conv.descripcion_publica,
            descripcion_requisitos: conv.descripcion_requisitos,
            fecha_inicio: conv.fecha_inicio,
            fecha_limite: fechaLimiteReg,
            solicitud_codigo: conv.solicitud_codigo,
            solicitud_objeto: conv.solicitud_objeto,
            tipo_proponente: conv.tipo_proponente || 'empresa',
            vencida,
            puede_postular: !vencida,
            razon_cierre: vencida ? (conv.fase_invitacion_enviada ? 'invitacion_enviada' : 'plazo_vencido') : null,
        });
    } catch (err) {
        console.error('Error convocatoria pública:', err);
        return res.status(500).json({ error: 'Error al consultar la convocatoria.' });
    }
});

// POST /api/convocatoria-publica/:convocatoria_id/postular
// Cualquier persona externa envía su postulación.
// Crea una invitación nueva en convocatoria_invitaciones con es_postulacion_publica = TRUE.
app.post('/api/convocatoria-publica/:id/postular', proponenteRateLimit, async (req, res) => {
    const { id } = req.params;
    const {
        nombre_empresa, nombre_contacto, nit, nombre_completo, cedula, email, telefono, acepta_tratamiento_datos,
        tipo_documento, domicilio, pagina_web,
        representante_legal_nombre, representante_legal_tipo_id, representante_legal_identificacion,
        representante_legal_direccion, representante_legal_autorizado,
        ciiu, tarifa, regimen, actividad_economica, municipio_inscripcion,
        es_gran_contribuyente, gran_contribuyente_resolucion, gran_contribuyente_fecha,
        es_auto_retenedor, auto_retenedor_resolucion, auto_retenedor_fecha,
        es_entidad_estado, exento_impuesto_renta,
    } = req.body;

    const esBool = v => v === 'true' || v === true;
    const fallar = (status, error) => res.status(status).json({ error });

    const tipoPersona = nombre_completo ? 'persona' : 'empresa';
    const numeroDocumento = tipoPersona === 'persona' ? cedula : nit;

    if (!email) return fallar(400, 'El correo electrónico es obligatorio.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return fallar(400, 'El correo electrónico no es válido.');
    if (!nombre_empresa && !nombre_completo) return fallar(400, 'El nombre o razón social es obligatorio.');
    if (acepta_tratamiento_datos !== true) return fallar(400, 'Debes aceptar la Política de Tratamiento de Datos Personales para continuar.');

    // ── Validación de campos del formulario RA1-4 (identificación y datos tributarios — obligatorios en Fase 1) ──
    const camposTexto = {
        'Tipo de documento': tipo_documento, 'Número de documento': numeroDocumento,
        'Domicilio': domicilio, 'Teléfono': telefono,
        'CIIU': ciiu, 'Tarifa': tarifa, 'Régimen': regimen,
        'Actividad económica': actividad_economica, 'Municipio donde está inscrito': municipio_inscripcion,
    };
    for (const [label, valor] of Object.entries(camposTexto)) {
        if (!valor || !String(valor).trim()) return fallar(400, `El campo "${label}" es obligatorio.`);
    }
    if (es_gran_contribuyente === undefined || es_auto_retenedor === undefined || es_entidad_estado === undefined || exento_impuesto_renta === undefined) {
        return fallar(400, 'Debes responder todas las preguntas de estado tributario.');
    }
    if (esBool(es_gran_contribuyente) && (!gran_contribuyente_resolucion?.trim() || !gran_contribuyente_fecha)) {
        return fallar(400, 'Debes indicar la Resolución y Fecha de Gran Contribuyente.');
    }
    if (esBool(es_auto_retenedor) && (!auto_retenedor_resolucion?.trim() || !auto_retenedor_fecha)) {
        return fallar(400, 'Debes indicar la Resolución y Fecha de Auto Retenedor.');
    }
    if (tipoPersona === 'empresa') {
        if (!representante_legal_nombre?.trim() || !representante_legal_tipo_id?.trim() || !representante_legal_identificacion?.trim() || !representante_legal_direccion?.trim()) {
            return fallar(400, 'Los datos del representante legal son obligatorios.');
        }
    }

    const client = await pool.connect();
    try {
        await ensureConvocatoriasStorage();
        await client.query('BEGIN');

        // Verificar que la convocatoria existe, está activa y el plazo de REGISTRO no ha vencido
        const convRes = await client.query(
            `SELECT id, asunto, fecha_limite, fecha_limite_registro, link_publico_activo, fase_invitacion_enviada FROM convocatorias WHERE id = $1::uuid`,
            [id]
        );
        if (convRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return fallar(404, 'Convocatoria no encontrada.');
        }
        const conv = convRes.rows[0];
        // Verificar si la Fase 2 ya fue enviada (cierre automático del registro público)
        if (conv.fase_invitacion_enviada) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'La invitación formal ya fue enviada. El período de registro público ha cerrado.', razon_cierre: 'invitacion_enviada' });
        }
        if (!conv.link_publico_activo) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'Esta convocatoria no está abierta para postulaciones.', razon_cierre: 'link_inactivo' });
        }
        // Fase 1: verificar contra fecha_limite_registro (no contra fecha_limite de propuestas)
        const fechaLimiteReg = conv.fecha_limite_registro || conv.fecha_limite;
        if (new Date() > new Date(fechaLimiteReg)) {
            await client.query('ROLLBACK');
            return res.status(403).json({ error: 'El plazo para registrarse ha vencido.', fecha_limite: fechaLimiteReg, razon_cierre: 'plazo_vencido' });
        }

        // Ver si ya existe una fila para este email en esta convocatoria: puede ser un
        // "proponente conocido" que Jurídica agregó directamente al crear la convocatoria
        // (sin RA1-4 todavía, tipo_documento IS NULL) — en ese caso se completa esa misma
        // fila en vez de rechazar, para que quede registrado vía el link público y pueda
        // recibir la invitación de Fase 2. Si ya tiene RA1-4 diligenciado, sí es duplicado.
        const existenteRes = await client.query(
            `SELECT id, token, tipo_documento FROM convocatoria_invitaciones WHERE convocatoria_id = $1::uuid AND proponente_email = $2`,
            [id, email.toLowerCase().trim()]
        );
        const filaExistente = existenteRes.rows[0] || null;
        if (filaExistente && filaExistente.tipo_documento) {
            await client.query('ROLLBACK');
            return fallar(409, 'Ya existe una postulación registrada con ese correo para esta convocatoria.');
        }

        const token = filaExistente?.token || generarToken();
        const ip = getClientIp(req);

        // Construir nombre y cédula/NIT según el tipo de proponente
        const nombreRegistro = tipoPersona === 'persona'
            ? nombre_completo.trim()
            : (nombre_contacto ? `${nombre_empresa} — ${nombre_contacto}` : nombre_empresa);
        const cedulaNit = numeroDocumento || null;

        const datosRA14 = [
            telefono || null, cedulaNit, tipoPersona, ip,
            tipo_documento.trim(), domicilio.trim(), (pagina_web || '').trim() || null,
            tipoPersona === 'empresa' ? representante_legal_nombre.trim() : null,
            tipoPersona === 'empresa' ? representante_legal_tipo_id.trim() : null,
            tipoPersona === 'empresa' ? representante_legal_identificacion.trim() : null,
            tipoPersona === 'empresa' ? representante_legal_direccion.trim() : null,
            tipoPersona === 'empresa' ? (representante_legal_autorizado || '').trim() || null : null,
            ciiu.trim(), tarifa.trim(), regimen.trim(), actividad_economica.trim(), municipio_inscripcion.trim(),
            esBool(es_gran_contribuyente), esBool(es_gran_contribuyente) ? gran_contribuyente_resolucion.trim() : null, esBool(es_gran_contribuyente) ? gran_contribuyente_fecha : null,
            esBool(es_auto_retenedor), esBool(es_auto_retenedor) ? auto_retenedor_resolucion.trim() : null, esBool(es_auto_retenedor) ? auto_retenedor_fecha : null,
            esBool(es_entidad_estado), esBool(exento_impuesto_renta),
        ];

        const invRes = filaExistente
            ? await client.query(
                // No se sobrescribe proponente_nombre: se conserva el nombre que Jurídica
                // escribió al agregar este proponente — solo se completan los datos del RA1-4.
                `UPDATE convocatoria_invitaciones SET
                    es_postulacion_publica = TRUE,
                    telefono = $2, cedula_nit = $3, tipo_persona = $4,
                    primer_acceso_en = COALESCE(primer_acceso_en, NOW()),
                    ip_acceso = COALESCE(ip_acceso, $5),
                    total_accesos = COALESCE(total_accesos, 0) + 1,
                    acepta_tratamiento_datos = TRUE, acepta_tratamiento_datos_en = NOW(),
                    tipo_documento = $6, domicilio = $7, pagina_web = $8,
                    representante_legal_nombre = $9, representante_legal_tipo_id = $10, representante_legal_identificacion = $11,
                    representante_legal_direccion = $12, representante_legal_autorizado = $13,
                    ciiu = $14, tarifa = $15, regimen = $16, actividad_economica = $17, municipio_inscripcion = $18,
                    es_gran_contribuyente = $19, gran_contribuyente_resolucion = $20, gran_contribuyente_fecha = $21,
                    es_auto_retenedor = $22, auto_retenedor_resolucion = $23, auto_retenedor_fecha = $24,
                    es_entidad_estado = $25, exento_impuesto_renta = $26
                 WHERE id = $1::uuid
                 RETURNING id, token`,
                [filaExistente.id, ...datosRA14]
              )
            : await client.query(
                `INSERT INTO convocatoria_invitaciones
                    (convocatoria_id, proponente_email, proponente_nombre, token,
                     es_postulacion_publica, telefono, cedula_nit, tipo_persona,
                     primer_acceso_en, ip_acceso, total_accesos,
                     respondida, respuesta_archivos,
                     acepta_tratamiento_datos, acepta_tratamiento_datos_en,
                     tipo_documento, domicilio, pagina_web,
                     representante_legal_nombre, representante_legal_tipo_id, representante_legal_identificacion,
                     representante_legal_direccion, representante_legal_autorizado,
                     ciiu, tarifa, regimen, actividad_economica, municipio_inscripcion,
                     es_gran_contribuyente, gran_contribuyente_resolucion, gran_contribuyente_fecha,
                     es_auto_retenedor, auto_retenedor_resolucion, auto_retenedor_fecha,
                     es_entidad_estado, exento_impuesto_renta)
                 VALUES ($1::uuid, $2, $3, $4, TRUE, $5, $6, $7, NOW(), $8, 1, FALSE, '[]'::jsonb, TRUE, NOW(),
                     $9, $10, $11,
                     $12, $13, $14, $15, $16,
                     $17, $18, $19, $20, $21,
                     $22, $23, $24,
                     $25, $26, $27,
                     $28, $29)
                 RETURNING id, token`,
                [id, email.toLowerCase().trim(), nombreRegistro, token, ...datosRA14]
              );

        await client.query('COMMIT');

        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
        return res.status(201).json({
            mensaje: 'Postulación registrada exitosamente.',
            postulacion_id: invRes.rows[0].id,
            enlace_seguimiento: `${FRONTEND_URL}/respuesta-proponente?token=${invRes.rows[0].token}`,
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error registrando postulación pública:', err);
        return res.status(500).json({ error: 'Error al registrar la postulación. Intente nuevamente.' });
    } finally {
        client.release();
    }
});

// POST /api/convocatorias/:id/enviar-fase1
// Envía el link público de registro a todos los proponentes conocidos (Fase 1).
// No envía el link de propuesta — solo invita a registrarse antes de fecha_limite_registro.
// ─── Envío de correo institucional a proponentes ────────────────────────────
// Orden de preferencia:
//   1) Microsoft Graph (app-only, mismas credenciales AZURE_* que usa SharePoint)
//      — recomendado: aprovecha el SPF/DKIM ya configurado del dominio de Invest in Bogotá,
//        necesario para que dominios externos (Gmail, Outlook, etc.) no rechacen el correo.
//   2) SMTP tradicional (SMTP_USER/SMTP_PASS) — alternativa si no se usa Microsoft Graph.
//   3) Cuenta de prueba Ethereal — último recurso; NO entrega correos reales,
//      solo genera una URL de vista previa. Se reporta explícitamente como modo "prueba".
let _graphMailToken = { token: null, exp: 0 };
async function obtenerTokenGraphMail() {
    const ahora = Date.now();
    if (_graphMailToken.token && ahora < _graphMailToken.exp - 60_000) return _graphMailToken.token;
    const tenantId = process.env.AZURE_TENANT_ID;
    const clientId = process.env.AZURE_CLIENT_ID;
    const clientSecret = process.env.AZURE_CLIENT_SECRET;
    const tokenRes = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: clientId,
            scope: 'https://graph.microsoft.com/.default',
            client_secret: clientSecret,
            grant_type: 'client_credentials',
        }),
    }).then(r => r.json());
    if (!tokenRes.access_token) {
        throw new Error('No se pudo obtener token de Microsoft Graph para envío de correo: ' + (tokenRes.error_description || JSON.stringify(tokenRes)));
    }
    _graphMailToken = { token: tokenRes.access_token, exp: ahora + (tokenRes.expires_in || 3600) * 1000 };
    return tokenRes.access_token;
}

async function prepararEnvioCorreo() {
    if (process.env.AZURE_TENANT_ID && process.env.AZURE_CLIENT_ID && process.env.AZURE_CLIENT_SECRET && process.env.GRAPH_MAIL_SENDER) {
        const token = await obtenerTokenGraphMail();
        const sender = process.env.GRAPH_MAIL_SENDER;
        return {
            modo: 'real',
            proveedor: 'graph',
            enviar: async ({ to, subject, html, attachments = [] }) => {
                const graphAttachments = attachments.map(a => ({
                    '@odata.type': '#microsoft.graph.fileAttachment',
                    name: a.filename,
                    contentBytes: fs.readFileSync(a.path).toString('base64'),
                }));
                const resp = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
                    method: 'POST',
                    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        message: {
                            subject,
                            body: { contentType: 'HTML', content: html },
                            toRecipients: [{ emailAddress: { address: to } }],
                            attachments: graphAttachments,
                        },
                        saveToSentItems: true,
                    }),
                });
                if (!resp.ok) {
                    const errText = await resp.text().catch(() => '');
                    throw new Error(`Microsoft Graph sendMail falló (${resp.status}): ${errText}`);
                }
                return {};
            },
        };
    }

    if (process.env.SMTP_USER && process.env.SMTP_PASS) {
        const transporter = nodemailer.createTransport({
            host: process.env.SMTP_HOST || 'smtp.gmail.com',
            port: parseInt(process.env.SMTP_PORT || '587'),
            secure: process.env.SMTP_SECURE === 'true',
            auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
        });
        return {
            modo: 'real',
            proveedor: 'smtp',
            enviar: async ({ to, subject, html, attachments = [] }) => {
                await transporter.sendMail({
                    from: `"Invest in Bogotá" <${process.env.SMTP_USER}>`,
                    to, subject, html, attachments,
                });
                return {};
            },
        };
    }

    const testAccount = await nodemailer.createTestAccount();
    const transporter = nodemailer.createTransport({
        host: 'smtp.ethereal.email', port: 587, secure: false,
        auth: { user: testAccount.user, pass: testAccount.pass },
    });
    return {
        modo: 'prueba',
        proveedor: 'ethereal',
        enviar: async ({ to, subject, html, attachments = [] }) => {
            const info = await transporter.sendMail({
                from: `"Invest in Bogotá (PRUEBA — no configurado)" <${testAccount.user}>`,
                to, subject, html, attachments,
            });
            return { previewUrl: nodemailer.getTestMessageUrl(info) };
        },
    };
}

app.post('/api/convocatorias/:id/enviar-fase1', async (req, res) => {
    const { id } = req.params;
    const { usuario_email } = req.body || {};
    try {
        await ensureConvocatoriasStorage();

        const convRes = await pool.query(
            `SELECT c.*, s.objeto, s.codigo
             FROM convocatorias c LEFT JOIN solicitudes s ON c.solicitud_id = s.id
             WHERE c.id = $1::uuid`,
            [id]
        );
        if (convRes.rows.length === 0) return res.status(404).json({ error: 'Convocatoria no encontrada.' });
        const conv = convRes.rows[0];

        if (conv.fase1_notificacion_enviada) {
            return res.status(409).json({ error: 'La Fase 1 ya fue enviada anteriormente.', ya_enviada: true });
        }

        // Proponentes conocidos registrados en la convocatoria (sin los de registro público)
        const invRes = await pool.query(
            `SELECT id, proponente_email, proponente_nombre
             FROM convocatoria_invitaciones
             WHERE convocatoria_id = $1::uuid AND es_postulacion_publica = FALSE`,
            [id]
        );

        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
        const linkPublico = `${FRONTEND_URL}/convocatoria-publica?id=${id}`;
        const fechaLimiteReg = conv.fecha_limite_registro
            ? new Date(conv.fecha_limite_registro).toLocaleString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : '';

        const envio = await prepararEnvioCorreo();

        const previews = [];
        await Promise.all(invRes.rows.map(async inv => {
            try {
                const resultado = await envio.enviar({
                    to: inv.proponente_email,
                    subject: `Invitación a registrarse — ${conv.asunto}`,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a2332;border:1px solid #e8ecf0;border-radius:12px;overflow:hidden;">
                            <div style="background:#1f4e79;padding:24px 32px;">
                                <p style="margin:0;font-size:22px;font-weight:900;color:#fff;">Invest in <span style="color:#E84922;">Bogotá</span></p>
                                <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.1em;">Portal de Compras y Contratación</p>
                            </div>
                            <div style="padding:32px;">
                                <p style="margin:0 0 8px;font-size:15px;font-weight:700;">Estimado(a) ${inv.proponente_nombre},</p>
                                <p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.6;">
                                    <strong>Invest in Bogotá</strong> le invita a registrarse en la siguiente convocatoria. El registro es el <strong>primer paso</strong> para poder presentar su propuesta.
                                </p>
                                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px;">
                                    <table style="width:100%;border-collapse:collapse;">
                                        <tr>
                                            <td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;padding-right:16px;vertical-align:top;">Convocatoria</td>
                                            <td style="padding:6px 0;font-size:14px;color:#1a2332;font-weight:600;">${conv.asunto}</td>
                                        </tr>
                                        ${conv.objeto ? `<tr>
                                            <td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;padding-right:16px;vertical-align:top;">Objeto</td>
                                            <td style="padding:6px 0;font-size:14px;color:#1a2332;">${conv.objeto}</td>
                                        </tr>` : ''}
                                        ${fechaLimiteReg ? `<tr>
                                            <td style="padding:6px 0;font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;padding-right:16px;vertical-align:top;">Registro hasta</td>
                                            <td style="padding:6px 0;font-size:14px;color:#dc2626;font-weight:700;">${fechaLimiteReg}</td>
                                        </tr>` : ''}
                                    </table>
                                </div>
                                ${conv.descripcion_publica ? `
                                <div style="margin-bottom:24px;padding:16px 18px;background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;">
                                    <p style="margin:0;font-size:13px;color:#245782;line-height:1.6;">${conv.descripcion_publica}</p>
                                </div>` : ''}
                                <p style="font-size:14px;color:#334155;margin:0 0 8px;line-height:1.6;">
                                    Para registrarse, haga clic en el siguiente enlace <strong>antes de la fecha límite</strong>. El registro solo requiere sus datos básicos — la propuesta formal se entregará en una etapa posterior.
                                </p>
                                <div style="text-align:center;margin:28px 0;">
                                    <a href="${linkPublico}" target="_blank"
                                       style="background-color:#E84922;color:#fff;padding:16px 36px;text-decoration:none;border-radius:10px;font-weight:800;display:inline-block;font-size:15px;">
                                        Registrarme en esta convocatoria
                                    </a>
                                </div>
                                <p style="text-align:center;font-size:11px;color:#245782;word-break:break-all;margin:0 0 24px;">${linkPublico}</p>
                                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
                                    <p style="margin:0;font-size:12px;color:#92400e;line-height:1.6;">
                                        ⚠️ Este enlace es público. Registrarse no garantiza la adjudicación.<br/>
                                        Recibirá un enlace personal para entregar su propuesta en una segunda etapa.
                                    </p>
                                </div>
                            </div>
                            <div style="background:#f8fafc;border-top:1px solid #e8ecf0;padding:16px 32px;text-align:center;">
                                <p style="margin:0;font-size:11px;color:#94a3b8;">Portal de Compras y Contratación — Invest in Bogotá · Bogotá, Colombia</p>
                            </div>
                        </div>
                    `,
                });
                if (envio.modo === 'prueba') {
                    previews.push({ email: inv.proponente_email, preview: resultado?.previewUrl });
                    console.log(`⚠️ Fase1 en modo PRUEBA (no llega al correo real) → ${inv.proponente_email} | ${resultado?.previewUrl}`);
                }
            } catch (e) {
                console.error(`❌ Error enviando Fase1 a ${inv.proponente_email}:`, e);
            }
        }));

        // Activar el link público + marcar Fase 1 enviada
        await pool.query(
            `UPDATE convocatorias SET link_publico_activo = TRUE, fase1_notificacion_enviada = TRUE, fase1_notificacion_enviada_en = NOW() WHERE id = $1::uuid`,
            [id]
        );

        const uFase1 = await usuarioPorEmail(usuario_email || conv.creada_por);
        await registrarLog({
            tipo_log: 'negocio', modulo: 'convocatorias', tabla: 'convocatorias',
            registro_id: id, accion: 'INVITACION_FASE1',
            campo: 'fase1_notificacion_enviada', valor_anterior: 'false', valor_nuevo: 'true',
            descripcion: `Fase 1 enviada para convocatoria "${conv.asunto}" — ${invRes.rows.length} proponente(s) notificado(s)`,
            usuario_id: uFase1?.id || null, rol_usuario: uFase1?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({
            ok: true,
            total_notificados: invRes.rows.length,
            mensaje: `Notificación de Fase 1 enviada a ${invRes.rows.length} proponente(s) conocido(s).`,
            modo_envio: envio.modo,
            previews,
        });
    } catch (err) {
        console.error('Error enviando Fase 1:', err);
        return res.status(500).json({ error: 'Error al enviar la notificación de Fase 1.' });
    }
});

// DELETE /api/convocatorias/:id
// Elimina una convocatoria completa (y sus invitaciones por CASCADE)
app.delete('/api/convocatorias/:id', async (req, res) => {
    const { id } = req.params;
    try {
        await ensureConvocatoriasStorage();
        const result = await pool.query(
            `DELETE FROM convocatorias WHERE id = $1::uuid RETURNING id`,
            [id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Convocatoria no encontrada' });
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error eliminando convocatoria:', err);
        return res.status(500).json({ error: 'Error al eliminar convocatoria' });
    }
});

// DELETE /api/convocatorias/:id/invitaciones/:invId
// Elimina una invitación individual (para limpiar duplicados o errores)
app.delete('/api/convocatorias/:id/invitaciones/:invId', async (req, res) => {
    const { id, invId } = req.params;
    try {
        await ensureConvocatoriasStorage();
        const result = await pool.query(
            `DELETE FROM convocatoria_invitaciones WHERE id = $1::uuid AND convocatoria_id = $2::uuid RETURNING id`,
            [invId, id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Invitación no encontrada' });
        return res.json({ ok: true });
    } catch (err) {
        console.error('Error eliminando invitación:', err);
        return res.status(500).json({ error: 'Error al eliminar invitación' });
    }
});

// POST /api/convocatorias/:id/enviar-invitacion-masiva
// Crea y envía el link individual de propuesta a TODOS:
//   - Los que se registraron vía link público (ya tienen token)
//   - Los proponentes originales de la solicitud que aún no tienen invitación
app.post('/api/convocatorias/:id/enviar-invitacion-masiva', async (req, res) => {
    const { id } = req.params;
    const { fecha_limite: fechaLimitePropuesta, usuario_email, tipo_objeto } = req.body; // Fase 2: plazo para entregar propuesta
    const client = await pool.connect();
    try {
        await ensureConvocatoriasStorage();
        await client.query('BEGIN');

        // 1. Obtener la convocatoria (LEFT JOIN para no fallar si no tiene solicitud asociada)
        const convRes = await client.query(
            `SELECT c.*, s.codigo, s.objeto
             FROM convocatorias c LEFT JOIN solicitudes s ON c.solicitud_id = s.id
             WHERE c.id = $1::uuid`,
            [id]
        );
        if (convRes.rows.length === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Convocatoria no encontrada.' });
        }
        let conv = convRes.rows[0];

        // Bloquear reenvío si la Fase 2 ya fue enviada (evita duplicados por doble click)
        if (conv.fase_invitacion_enviada) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'La invitación formal ya fue enviada anteriormente. No se puede reenviar.', ya_enviada: true });
        }

        // Si se envía una nueva fecha_limite para propuestas, actualizar la convocatoria
        const fechaLimiteUsada = fechaLimitePropuesta || conv.fecha_limite;
        if (!fechaLimiteUsada) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Debes indicar la fecha límite para entregar la propuesta.' });
        }
        if (fechaLimitePropuesta) {
            await client.query(
                `UPDATE convocatorias SET fecha_limite = $2 WHERE id = $1::uuid`,
                [id, fechaLimitePropuesta]
            );
            conv = { ...conv, fecha_limite: fechaLimitePropuesta };
        }

        // Tipo de objeto contractual — define los documentos RA1-4 exigidos al proponente
        // (bienes y servicios / servicios profesionales). Se puede fijar hasta el envío de Fase 2.
        if (tipo_objeto === 'bienes_servicios' || tipo_objeto === 'servicios_profesionales') {
            await client.query(
                `UPDATE convocatorias SET tipo_objeto = $2 WHERE id = $1::uuid`,
                [id, tipo_objeto]
            );
            conv = { ...conv, tipo_objeto };
        }

        // 2. Proponentes ya registrados en esta convocatoria (públicos o directos)
        const existentesRes = await client.query(
            `SELECT proponente_email FROM convocatoria_invitaciones WHERE convocatoria_id = $1::uuid`,
            [id]
        );
        // Normalizar: extraer el email real si el campo contiene una cadena de contacto completa
        // (ej: "juan correo: juan@co.com teléfono: 123" → "juan@co.com")
        const extraerEmail = (s) => {
            if (!s) return '';
            const m = s.match(/[^\s@]+@[^\s@]+\.[^\s@]+/);
            return m ? m[0].toLowerCase() : s.toLowerCase();
        };
        const emailsExistentes = new Set(existentesRes.rows.map(r => extraerEmail(r.proponente_email)));

        // 3. Proponentes originales de la solicitud que aún NO están en esta convocatoria
        const propOrigRes = await client.query(
            `SELECT nombre_proveedor, datos_contacto FROM proponentes WHERE solicitud_id = $1::uuid`,
            [conv.solicitud_id]
        );

        // Crear invitaciones nuevas solo para los que no están ya registrados
        const nuevasInvitaciones = [];
        for (const p of propOrigRes.rows) {
            const emailRaw = (p.datos_contacto || '').match(/[^\s@]+@[^\s@]+\.[^\s@]+/)?.[0] || '';
            const email = emailRaw.toLowerCase().trim();
            if (!email || emailsExistentes.has(email)) continue;

            const token = generarToken();
            const invRes = await client.query(
                `INSERT INTO convocatoria_invitaciones
                    (convocatoria_id, proponente_email, proponente_nombre, token, respondida, respuesta_archivos)
                 VALUES ($1::uuid, $2, $3, $4, FALSE, '[]'::jsonb)
                 RETURNING id, token, proponente_email, proponente_nombre`,
                [id, email, p.nombre_proveedor || email, token]
            );
            nuevasInvitaciones.push(invRes.rows[0]);
            emailsExistentes.add(email);
        }

        await client.query('COMMIT');

        // 4. Obtener las invitaciones de esta convocatoria que YA completaron su registro
        // RA1-4 en el link público (tipo_documento IS NOT NULL) — solo ellas pueden recibir
        // la invitación formal de Fase 2. Las que aún no se registraron quedan pendientes
        // (se cuentan en "omitidos_sin_ra14" para que Jurídica sepa que faltan por registrarse).
        const todasRes = await pool.query(
            `SELECT id, proponente_email, proponente_nombre, token
             FROM convocatoria_invitaciones
             WHERE convocatoria_id = $1::uuid AND tipo_documento IS NOT NULL AND link_enviado_en IS NULL`,
            [id]
        );
        const omitidosRes = await pool.query(
            `SELECT COUNT(*)::int as total FROM convocatoria_invitaciones WHERE convocatoria_id = $1::uuid AND tipo_documento IS NULL`,
            [id]
        );
        const omitidosSinRA14 = omitidosRes.rows[0]?.total || 0;

        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
        const enlacesParaEnviar = todasRes.rows.map(inv => ({
            ...inv,
            enlace: `${FRONTEND_URL}/respuesta-proponente?token=${inv.token}`
        }));

        // 5. Preparar canal de envío de correo
        const envio = await prepararEnvioCorreo();

        // 6. Marcar link_enviado_en (solo para los que sí recibieron el enlace, con RA1-4 completado)
        await pool.query(
            `UPDATE convocatoria_invitaciones SET link_enviado_en = NOW()
             WHERE convocatoria_id = $1::uuid AND link_enviado_en IS NULL AND tipo_documento IS NOT NULL`,
            [id]
        ).catch(() => { });
        // Cerrar el link público y marcar la Fase 2 como enviada SOLO si ya no quedan
        // proponentes pendientes de completar su registro RA1-4: si aún faltan, el link
        // público sigue activo para que puedan registrarse, y Jurídica puede volver a
        // llamar este mismo endpoint más adelante para notificarles cuando ya se registren.
        if (omitidosSinRA14 === 0) {
            await pool.query(
                `UPDATE convocatorias
                 SET fase_invitacion_enviada = TRUE,
                     invitacion_enviada_en   = NOW(),
                     link_publico_activo     = FALSE
                 WHERE id = $1::uuid`,
                [id]
            ).catch(() => { });
        }

        // 7. Preparar adjunto del documento si existe
        const docAttachments = [];
        if (conv.documento_adjunto_url) {
            const docFilename = conv.documento_adjunto_url.split('/').pop();
            if (docFilename) {
                const docFilePath = path.join(UPLOADS_DIR, docFilename);
                if (fs.existsSync(docFilePath)) {
                    docAttachments.push({ filename: conv.documento_adjunto_nombre || docFilename, path: docFilePath });
                }
            }
        }

        // 8. Enviar correos en paralelo (sin bloquear la respuesta)
        const previews = [];
        await Promise.all(enlacesParaEnviar.map(async inv => {
            try {
                const resultado = await envio.enviar({
                    to: inv.proponente_email,
                    subject: `Invitación a presentar propuesta — ${conv.asunto}`,
                    html: `
                        <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a2332;border:1px solid #e8ecf0;border-radius:12px;overflow:hidden;">
                            <!-- Header -->
                            <div style="background:#1f4e79;padding:24px 32px;">
                                <p style="margin:0;font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Invest in <span style="color:#E84922;">Bogotá</span></p>
                                <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.1em;">Portal de Compras y Contratación</p>
                            </div>
                            <!-- Body -->
                            <div style="padding:32px;">
                                <p style="margin:0 0 8px;font-size:15px;font-weight:700;">Estimado(a) ${inv.proponente_nombre},</p>
                                <p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.6;">
                                    Ha sido seleccionado(a) para presentar su propuesta en la siguiente convocatoria de <strong>Invest in Bogotá</strong>. A continuación encontrará los detalles y su enlace personal de acceso.
                                </p>

                                <!-- Info card -->
                                <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px;">
                                    <table style="width:100%;border-collapse:collapse;">
                                        <tr>
                                            <td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;padding-right:16px;vertical-align:top;">Convocatoria</td>
                                            <td style="padding:6px 0;font-size:14px;color:#1a2332;font-weight:600;">${conv.asunto}</td>
                                        </tr>
                                        ${conv.objeto ? `<tr>
                                            <td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;padding-right:16px;vertical-align:top;">Objeto</td>
                                            <td style="padding:6px 0;font-size:14px;color:#1a2332;">${conv.objeto}</td>
                                        </tr>` : ''}
                                        <tr>
                                            <td style="padding:6px 0;font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;padding-right:16px;vertical-align:top;">Fecha límite</td>
                                            <td style="padding:6px 0;font-size:14px;color:#dc2626;font-weight:700;">${new Date(fechaLimiteUsada).toLocaleString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                        </tr>
                                    </table>
                                </div>

                                ${conv.descripcion_requisitos ? `
                                <!-- Descripción y requisitos -->
                                <div style="margin-bottom:24px;">
                                    <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a2332;text-transform:uppercase;letter-spacing:0.05em;">Descripción y Requisitos</p>
                                    <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;font-size:13px;color:#334155;line-height:1.7;white-space:pre-line;">${conv.descripcion_requisitos}</div>
                                </div>` : ''}

                                ${conv.documento_adjunto_url ? `
                                <!-- Documento adjunto -->
                                <div style="margin-bottom:24px;">
                                    <p style="margin:0 0 8px;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.08em;">Documento adjunto</p>
                                    <div style="background:#EFF6FF;border:1px solid #BFDBFE;border-radius:10px;padding:14px 18px;display:flex;align-items:flex-start;gap:12px;">
                                        <span style="font-size:20px;flex-shrink:0;">📎</span>
                                        <div>
                                            <p style="margin:0 0 2px;font-size:13px;font-weight:700;color:#245782;">${conv.documento_adjunto_nombre || 'Documento adjunto'}</p>
                                            <p style="margin:0;font-size:12px;color:#334155;line-height:1.5;">Encuentra el archivo adjunto en este correo.</p>
                                        </div>
                                    </div>
                                </div>` : ''}

                                <!-- CTA -->
                                <div style="text-align:center;margin:32px 0;">
                                    <a href="${inv.enlace}" target="_blank"
                                       style="background-color:#E84922;color:#fff;padding:16px 36px;text-decoration:none;border-radius:10px;font-weight:800;display:inline-block;font-size:15px;letter-spacing:0.02em;">
                                        Ingresar y Entregar mi Propuesta
                                    </a>
                                </div>
                                <p style="text-align:center;font-size:12px;color:#94a3b8;margin:0 0 8px;">O copia este enlace en tu navegador:</p>
                                <p style="text-align:center;font-size:11px;color:#245782;word-break:break-all;margin:0 0 32px;">${inv.enlace}</p>

                                <!-- Aviso -->
                                <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
                                    <p style="margin:0;font-size:12px;color:#92400e;line-height:1.6;">
                                        ⚠️ <strong>Este enlace es personal e intransferible.</strong> No lo comparta con terceros.<br/>
                                        Una vez vencida la fecha límite no se aceptarán más propuestas.
                                    </p>
                                </div>
                            </div>
                            <!-- Footer -->
                            <div style="background:#f8fafc;border-top:1px solid #e8ecf0;padding:16px 32px;text-align:center;">
                                <p style="margin:0;font-size:11px;color:#94a3b8;">Portal de Compras y Contratación — Invest in Bogotá · Bogotá, Colombia</p>
                            </div>
                        </div>
                    `,
                    attachments: docAttachments,
                });
                if (envio.modo === 'prueba') {
                    previews.push({ email: inv.proponente_email, preview: resultado?.previewUrl });
                    console.log(`⚠️ Fase2 en modo PRUEBA (no llega al correo real) → ${inv.proponente_email} | ${resultado?.previewUrl}`);
                } else {
                    console.log(`✅ Email enviado → ${inv.proponente_email}`);
                }
            } catch (e) {
                console.error(`❌ Error enviando a ${inv.proponente_email}:`, e);
            }
        }));

        const uMasiva = await usuarioPorEmail(usuario_email || conv.creada_por);
        await registrarLog({
            tipo_log: 'negocio', modulo: 'convocatorias', tabla: 'convocatorias',
            registro_id: id, accion: 'INVITACION_MASIVA',
            campo: 'fase_invitacion_enviada', valor_anterior: 'false', valor_nuevo: 'true',
            descripcion: `Fase 2 (invitación masiva) enviada — ${enlacesParaEnviar.length} proponente(s) notificado(s), ${nuevasInvitaciones.length} nuevo(s) agregado(s)`,
            usuario_id: uMasiva?.id || null, rol_usuario: uMasiva?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.status(200).json({
            ok: true,
            total_enviados: enlacesParaEnviar.length,
            nuevos_agregados: nuevasInvitaciones.length,
            omitidos_sin_ra14: omitidosSinRA14,
            mensaje: `Invitación enviada a ${enlacesParaEnviar.length} proponente(s). ${nuevasInvitaciones.length} nuevo(s) agregado(s) desde la solicitud.`
                + (omitidosSinRA14 > 0 ? ` ${omitidosSinRA14} proponente(s) no recibieron la invitación porque aún no completan su registro RA1-4 en el link público.` : ''),
            modo_envio: envio.modo,
            invitaciones: enlacesParaEnviar,
            previews,
        });

    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Error invitación masiva:', err);
        return res.status(500).json({ error: 'Error al enviar las invitaciones.' });
    } finally {
        client.release();
    }
});

// POST /api/convocatorias/:convId/invitaciones/:invId/enviar-link
// Jurídica envía el link individual de propuesta a un proponente registrado vía link público.
app.post('/api/convocatorias/:convId/invitaciones/:invId/enviar-link', async (req, res) => {
    const { convId, invId } = req.params;
    try {
        await ensureConvocatoriasStorage();

        const result = await pool.query(
            `SELECT ci.id, ci.proponente_email, ci.proponente_nombre, ci.token, ci.tipo_documento,
                    c.asunto, c.fecha_limite, c.descripcion_requisitos,
                    s.objeto
             FROM convocatoria_invitaciones ci
             JOIN convocatorias c ON ci.convocatoria_id = c.id
             JOIN solicitudes s ON c.solicitud_id = s.id
             WHERE ci.id = $1::uuid AND ci.convocatoria_id = $2::uuid`,
            [invId, convId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ error: 'Invitación no encontrada.' });
        }
        const inv = result.rows[0];

        // El proponente debe haber completado su registro RA1-4 en el link público
        // antes de poder recibir la invitación formal de Fase 2.
        if (!inv.tipo_documento) {
            return res.status(409).json({
                error: 'Este proponente aún no ha completado su registro (RA1-4) en el link público. Debe registrarse primero antes de poder enviarle la invitación.',
                requiere_ra14: true,
            });
        }

        // Verificar que el plazo no haya vencido
        if (new Date() > new Date(inv.fecha_limite)) {
            return res.status(403).json({ error: 'El plazo de esta convocatoria ha vencido.' });
        }

        const FRONTEND_URL = process.env.FRONTEND_URL || 'http://localhost:3000';
        const enlace = `${FRONTEND_URL}/respuesta-proponente?token=${inv.token}`;

        const envio = await prepararEnvioCorreo();

        const resultado = await envio.enviar({
            to: inv.proponente_email,
            subject: `Invitación a presentar propuesta — ${inv.asunto}`,
            html: `
                <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;color:#1a2332;border:1px solid #e8ecf0;border-radius:12px;overflow:hidden;">
                    <div style="background:#1f4e79;padding:24px 32px;">
                        <p style="margin:0;font-size:22px;font-weight:900;color:#fff;letter-spacing:-0.5px;">Invest in <span style="color:#E84922;">Bogotá</span></p>
                        <p style="margin:4px 0 0;font-size:11px;color:rgba(255,255,255,0.6);text-transform:uppercase;letter-spacing:0.1em;">Portal de Compras y Contratación</p>
                    </div>
                    <div style="padding:32px;">
                        <p style="margin:0 0 8px;font-size:15px;font-weight:700;">Estimado(a) ${inv.proponente_nombre},</p>
                        <p style="margin:0 0 24px;font-size:14px;color:#334155;line-height:1.6;">
                            Ha sido seleccionado(a) para presentar su propuesta en la siguiente convocatoria de <strong>Invest in Bogotá</strong>.
                        </p>
                        <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:20px;margin-bottom:24px;">
                            <table style="width:100%;border-collapse:collapse;">
                                <tr>
                                    <td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;padding-right:16px;vertical-align:top;">Convocatoria</td>
                                    <td style="padding:6px 0;font-size:14px;color:#1a2332;font-weight:600;">${inv.asunto}</td>
                                </tr>
                                ${inv.objeto ? `<tr>
                                    <td style="padding:6px 0;font-size:12px;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;padding-right:16px;vertical-align:top;">Objeto</td>
                                    <td style="padding:6px 0;font-size:14px;color:#1a2332;">${inv.objeto}</td>
                                </tr>` : ''}
                                <tr>
                                    <td style="padding:6px 0;font-size:12px;font-weight:700;color:#dc2626;text-transform:uppercase;letter-spacing:0.05em;white-space:nowrap;padding-right:16px;vertical-align:top;">Fecha límite</td>
                                    <td style="padding:6px 0;font-size:14px;color:#dc2626;font-weight:700;">${new Date(inv.fecha_limite).toLocaleString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</td>
                                </tr>
                            </table>
                        </div>
                        ${inv.descripcion_requisitos ? `
                        <div style="margin-bottom:24px;">
                            <p style="margin:0 0 10px;font-size:13px;font-weight:700;color:#1a2332;text-transform:uppercase;letter-spacing:0.05em;">Descripción y Requisitos</p>
                            <div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:18px;font-size:13px;color:#334155;line-height:1.7;white-space:pre-line;">${inv.descripcion_requisitos}</div>
                        </div>` : ''}
                        <div style="text-align:center;margin:32px 0;">
                            <a href="${enlace}" target="_blank"
                               style="background-color:#E84922;color:#fff;padding:16px 36px;text-decoration:none;border-radius:10px;font-weight:800;display:inline-block;font-size:15px;letter-spacing:0.02em;">
                                Ingresar y Entregar mi Propuesta
                            </a>
                        </div>
                        <p style="text-align:center;font-size:12px;color:#94a3b8;margin:0 0 8px;">O copia este enlace en tu navegador:</p>
                        <p style="text-align:center;font-size:11px;color:#245782;word-break:break-all;margin:0 0 32px;">${enlace}</p>
                        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:14px 16px;">
                            <p style="margin:0;font-size:12px;color:#92400e;line-height:1.6;">
                                ⚠️ <strong>Este enlace es personal e intransferible.</strong> No lo comparta con terceros.<br/>
                                Una vez vencida la fecha límite no se aceptarán más propuestas.
                            </p>
                        </div>
                    </div>
                    <div style="background:#f8fafc;border-top:1px solid #e8ecf0;padding:16px 32px;text-align:center;">
                        <p style="margin:0;font-size:11px;color:#94a3b8;">Portal de Compras y Contratación — Invest in Bogotá · Bogotá, Colombia</p>
                    </div>
                </div>
            `,
        });

        if (envio.modo === 'prueba') {
            console.log(`\n⚠️ Reenvío en modo PRUEBA (no llega al correo real) → ${inv.proponente_email}`);
            console.log(`👀 Vista previa: ${resultado?.previewUrl}\n`);
        }

        // Marcar que el link fue enviado
        await pool.query(
            `UPDATE convocatoria_invitaciones SET link_enviado_en = NOW() WHERE id = $1::uuid`,
            [invId]
        ).catch(() => { }); // columna opcional, ignorar si no existe

        await registrarLog({
            tipo_log: 'negocio', modulo: 'convocatorias', tabla: 'convocatoria_invitaciones',
            registro_id: invId, accion: 'INVITACION_LINK',
            campo: 'link_enviado_en', valor_anterior: null, valor_nuevo: new Date().toISOString(),
            descripcion: `Enlace personal de propuesta enviado a ${inv.proponente_email} para convocatoria "${inv.asunto}"`,
            usuario_id: req.auth?.usuarioId || null, rol_usuario: req.auth?.rol || 'juridica',
            ip_address: getClientIp(req), resultado: 'exitoso'
        });

        return res.json({
            ok: true,
            mensaje: `Enlace enviado a ${inv.proponente_email}`,
            enlace,
            modo_envio: envio.modo,
            preview: envio.modo === 'prueba' ? resultado?.previewUrl : null,
        });
    } catch (err) {
        console.error('Error enviando link individual:', err);
        return res.status(500).json({ error: 'Error al enviar el enlace.' });
    }
});

// PUT /api/convocatorias/:id/link-publico
// Habilita o deshabilita el link público de una convocatoria.
app.put('/api/convocatorias/:id/link-publico', async (req, res) => {
    const { id } = req.params;
    const { activo } = req.body;
    try {
        await ensureConvocatoriasStorage();
        const result = await pool.query(
            `UPDATE convocatorias SET link_publico_activo = $1 WHERE id = $2::uuid RETURNING id, link_publico_activo`,
            [Boolean(activo), id]
        );
        if (result.rows.length === 0) return res.status(404).json({ error: 'Convocatoria no encontrada' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al actualizar el link público' });
    }
});

// ─── Migración automática: columnas nuevas ────────────────────
(async () => {
    try {
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS titulo_contrato TEXT`);
        console.log('✓ Columna titulo_contrato verificada en solicitudes');
    } catch (e) {
        console.error('Advertencia al verificar columna titulo_contrato:', e.message);
    }
})();

// ─── Migración 41: fechas estimadas en tabla solicitudes ──────
(async () => {
    try {
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS fecha_estimada_solicitud DATE`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS fecha_estimada_recepcion DATE`);
        console.log('✓ Columnas fecha_estimada_solicitud / fecha_estimada_recepcion verificadas en solicitudes');
    } catch (e) {
        console.error('Advertencia al verificar columnas fecha_estimada:', e.message);
    }
})();

// ─── Migración: tabla seguimiento actas de adjudicación firmadas ─
(async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS actas_firmas (
                id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                solicitud_id UUID NOT NULL,
                agreement_id TEXT NOT NULL,
                estado      TEXT NOT NULL DEFAULT 'enviado',
                pdf_path    TEXT,
                firmantes   JSONB,
                creado_en   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                actualizado_en TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS actas_firmas_solicitud_idx ON actas_firmas(solicitud_id)`);
        await pool.query(`ALTER TABLE actas_firmas ADD COLUMN IF NOT EXISTS pdf_firmado_path TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS codigo_original TEXT`);
        console.log('✓ Tabla actas_firmas verificada');
    } catch (e) {
        console.error('Advertencia al verificar actas_firmas:', e.message);
    }
})();

// ─── Migración: columnas pago financiera en facturas ─────────
(async () => {
    try {
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS pagado_financiera BOOLEAN NOT NULL DEFAULT FALSE`);
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS fecha_pago_financiera DATE`);
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS confirmado_por_financiera TEXT`);
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS valor NUMERIC(18,2) DEFAULT 0`);
        console.log('✓ Columnas pagado_financiera/valor verificadas en facturas_contrato');
    } catch (e) {
        console.error('Advertencia al verificar columnas pago financiera:', e.message);
    }
})();

// ─── Migración: proveedor y método de pago en facturas ───────
(async () => {
    try {
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS nombre_proveedor VARCHAR(255)`);
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS metodo_pago VARCHAR(20) CHECK (metodo_pago IN ('pse','tarjeta','transferencia'))`);
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS numero_ap VARCHAR(100)`);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_facturas_contrato_numero_ap ON facturas_contrato(numero_ap)`);
        console.log('✓ Columnas nombre_proveedor/metodo_pago/numero_ap verificadas en facturas_contrato');
    } catch (e) {
        console.error('Advertencia al verificar columnas proveedor/metodo_pago:', e.message);
    }
})();

// ─── Migración: columnas faltantes en solicitudes ─────────────
(async () => {
    try {
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS anexos_solicitante TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS analisis_plazo_promedio_meses TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS analisis_plazo_promedio_dias TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS justificacion_anticipo TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS obligaciones_especificas TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS entregables_detalle TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS experiencia_acreditada_exigida TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS criterios_habilitantes_planeacion TEXT`);
        console.log('✓ Columnas faltantes verificadas en solicitudes');
    } catch (e) {
        console.error('Advertencia al verificar columnas faltantes en solicitudes:', e.message);
    }
})();

// ─── Inicializar tabla jurídica al arranque ───────────────────
(async () => {
    try {
        await ensureJuridicaDetailStorage();
        console.log('✓ Tabla solicitudes_detalle_juridico verificada');
    } catch (e) {
        console.error('Advertencia al verificar tabla juridica:', e.message);
    }
})();

// ─── Migración: columnas financiera + rubros + enum estados ──
(async () => {
    try {
        // Columnas que financiera necesita en solicitudes
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS rubro VARCHAR(255)`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS presupuesto_aprobado NUMERIC(18,2)`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS resultado_juridica TEXT`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS informes_supervision BOOLEAN DEFAULT FALSE`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS numero_informes INTEGER DEFAULT 0`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS titulo_contrato TEXT`);

        // Tabla de rubros presupuestales (catálogo)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS rubros_presupuestales (
                id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                codigo          VARCHAR(20),
                nombre          VARCHAR(200) NOT NULL,
                gerencia_nombre VARCHAR(200),
                activo          BOOLEAN NOT NULL DEFAULT TRUE,
                creado_en       TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);

        // Valores de enum que faltan (deben ejecutarse fuera de transacción — pool.query es auto-commit)
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'enviado_juridica'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'finalizado'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'aprobado_comite'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'rechazado_comite'`);

        // Flujo Riesgos: Jurídica (concepto) → Riesgos (si aplica) → Comité → Jurídica (resto)
        await pool.query(`ALTER TYPE rol_usuario ADD VALUE IF NOT EXISTS 'riesgos'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'en_juridica_concepto'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'en_riesgos'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'rechazado_riesgos'`);
        await pool.query(`ALTER TYPE estado_solicitud ADD VALUE IF NOT EXISTS 'en_comite'`);

        console.log('✓ Columnas financiera, rubros_presupuestales y enum estados verificados');
    } catch (e) {
        console.error('Advertencia al verificar columnas financiera/enum:', e.message);
    }
})();

// ─── Migración: columnas restantes (proponentes, auditoria, tablas supervisión) ──
(async () => {
    try {
        // solicitudes: fechas de envío
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS fecha_envio_financiera TIMESTAMPTZ`);
        await pool.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS fecha_envio_juridica TIMESTAMPTZ`);

        // proponentes: campos de cotización
        await pool.query(`ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS valor_cotizacion NUMERIC(18,2)`);
        await pool.query(`ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS plazo_meses INTEGER`);
        await pool.query(`ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS plazo_dias INTEGER`);
        await pool.query(`ALTER TABLE proponentes ADD COLUMN IF NOT EXISTS actualizado_en TIMESTAMPTZ DEFAULT NOW()`);

        // facturas_contrato: nombre de adjunto
        await pool.query(`ALTER TABLE facturas_contrato ADD COLUMN IF NOT EXISTS adjunto_nombre TEXT`);

        // auditoria: campos extendidos
        await pool.query(`ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS tipo_log VARCHAR(50) DEFAULT 'negocio'`);
        await pool.query(`ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS modulo VARCHAR(100)`);
        await pool.query(`ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS descripcion TEXT`);
        await pool.query(`ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS rol_usuario VARCHAR(100)`);
        await pool.query(`ALTER TABLE auditoria ADD COLUMN IF NOT EXISTS resultado VARCHAR(50) DEFAULT 'exitoso'`);

        // Tabla entregables_supervisor
        await pool.query(`
            CREATE TABLE IF NOT EXISTS entregables_supervisor (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                solicitud_id     UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
                nombre           TEXT NOT NULL,
                orden            INTEGER NOT NULL DEFAULT 0,
                completado       BOOLEAN NOT NULL DEFAULT FALSE,
                fecha_completado TIMESTAMPTZ,
                creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_entregables_supervisor_solicitud ON entregables_supervisor(solicitud_id)`);

        // Tabla informes_supervision_contrato
        await pool.query(`
            CREATE TABLE IF NOT EXISTS informes_supervision_contrato (
                id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
                solicitud_id     UUID NOT NULL REFERENCES solicitudes(id) ON DELETE CASCADE,
                numero           INTEGER NOT NULL,
                completado       BOOLEAN NOT NULL DEFAULT FALSE,
                observaciones    TEXT,
                fecha_completado TIMESTAMPTZ,
                creado_en        TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
        `);
        await pool.query(`CREATE INDEX IF NOT EXISTS idx_informes_supervision_solicitud ON informes_supervision_contrato(solicitud_id)`);

        console.log('✓ Columnas proponentes/auditoria y tablas supervisión verificadas');
    } catch (e) {
        console.error('Advertencia al verificar columnas restantes:', e.message);
    }
})();

// GET /api/financiera/facturas-aprobadas — facturas aprobadas por supervisor y gerente, pendientes de confirmación de pago
app.get('/api/financiera/facturas-aprobadas', async (_req, res) => {
    try {
        const result = await pool.query(
            `SELECT fc.id, fc.no_factura_cxc, fc.no_contrato_oc, fc.numero_ap, fc.concepto, fc.valor,
                    fc.nombre_proveedor,
                    fc.fecha_factura, fc.estado, fc.aprobado_supervisor, fc.aprobado_gerente,
                    fc.pagado_financiera, fc.fecha_pago_financiera, fc.confirmado_por_financiera, fc.metodo_pago,
                    fc.creado_en, fc.actualizado_en,
                    s.id AS solicitud_id, s.codigo AS contrato_codigo, s.objeto AS contrato_objeto
             FROM facturas_contrato fc
             JOIN solicitudes s ON s.id = fc.solicitud_id
             WHERE fc.estado = 'aprobada'
             ORDER BY fc.pagado_financiera ASC, fc.actualizado_en DESC`
        );
        return res.json(result.rows);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al obtener facturas aprobadas' });
    }
});

const METODOS_PAGO_VALIDOS = ['pse', 'tarjeta', 'transferencia'];

// PATCH /api/financiera/facturas/:id/marcar-pago — financiera confirma el pago con fecha
app.patch('/api/financiera/facturas/:id/marcar-pago', async (req, res) => {
    const { id } = req.params;
    const { pagado, fecha_pago, confirmado_por, metodo_pago } = req.body;
    if (typeof pagado !== 'boolean') {
        return res.status(400).json({ error: '"pagado" debe ser true o false' });
    }
    if (pagado && !fecha_pago) {
        return res.status(400).json({ error: 'La fecha de pago es requerida al confirmar pago' });
    }
    if (pagado && metodo_pago && !METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
        return res.status(400).json({ error: 'metodo_pago debe ser pse, tarjeta o transferencia' });
    }
    try {
        const result = await pool.query(
            `UPDATE facturas_contrato
             SET pagado_financiera=$1,
                 fecha_pago_financiera=$2,
                 confirmado_por_financiera=$3,
                 metodo_pago=$4,
                 actualizado_en=NOW()
             WHERE id=$5 RETURNING *`,
            [pagado, pagado ? fecha_pago : null, confirmado_por || null, pagado ? (metodo_pago || null) : null, id]
        );
        if (!result.rows.length) return res.status(404).json({ error: 'Factura no encontrada' });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al confirmar pago' });
    }
});

// PATCH /api/financiera/facturas/pagar-lote — financiera confirma el pago de varias facturas a la vez
app.patch('/api/financiera/facturas/pagar-lote', async (req, res) => {
    const { ids, fecha_pago, metodo_pago, confirmado_por } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
        return res.status(400).json({ error: '"ids" debe ser un arreglo con al menos una factura' });
    }
    if (!fecha_pago) {
        return res.status(400).json({ error: 'La fecha de pago es requerida' });
    }
    if (!METODOS_PAGO_VALIDOS.includes(metodo_pago)) {
        return res.status(400).json({ error: 'metodo_pago debe ser pse, tarjeta o transferencia' });
    }
    try {
        const result = await pool.query(
            `UPDATE facturas_contrato
             SET pagado_financiera=TRUE,
                 fecha_pago_financiera=$1,
                 metodo_pago=$2,
                 confirmado_por_financiera=$3,
                 actualizado_en=NOW()
             WHERE id = ANY($4::uuid[]) AND estado='aprobada'
             RETURNING *`,
            [fecha_pago, metodo_pago, confirmado_por || null, ids]
        );
        return res.json({ facturas: result.rows, actualizadas: result.rows.length });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: 'Error al confirmar el pago por lote' });
    }
});

// ─── Iniciar servidor ─────────────────────────────────────────
const PORT = process.env.API_PORT || 3001;
app.listen(PORT, () => {
    console.log(`🚀 API corriendo en http://localhost:${PORT}`);
    console.log(`   Health check: http://localhost:${PORT}/api/health`);
});
