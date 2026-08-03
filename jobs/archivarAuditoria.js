// ============================================================
// Archivado (no destructivo) de logs de auditoría vencidos.
// ------------------------------------------------------------
// Copia a `auditoria_archivo` los registros que superan la retención
// documentada en 13_audit_enhanced.sql (tecnico=12 meses, acceso=5 años,
// resto=5 años) — nunca borra nada de `auditoria`. Un borrado real
// necesitaría una Tabla de Retención Documental aprobada (Ley 594/2000),
// no solo este job.
//
// También crea automáticamente la partición anual siguiente de
// `auditoria`, para no depender de que alguien la agregue a mano
// cada año (hoy la última partición creada es auditoria_2027).
// ============================================================

import cron from 'node-cron';

const RETENCION_MESES_TECNICO = 12;
const RETENCION_MESES_ACCESO = 60;
const RETENCION_MESES_DEFAULT = 60;

async function archivarPorTipo(pool, condicionSql, params, meses) {
    const idx = params.length + 1;
    const sql = `
        INSERT INTO auditoria_archivo (id, tabla, registro_id, accion, campo, valor_anterior, valor_nuevo,
                                        usuario_id, ip_address, creado_en, tipo_log, modulo, descripcion, rol_usuario, resultado)
        SELECT a.id, a.tabla, a.registro_id, a.accion, a.campo, a.valor_anterior, a.valor_nuevo,
               a.usuario_id, a.ip_address, a.creado_en, a.tipo_log, a.modulo, a.descripcion, a.rol_usuario, a.resultado
        FROM auditoria a
        WHERE ${condicionSql}
          AND a.creado_en < NOW() - ($${idx} || ' months')::interval
          AND NOT EXISTS (
              SELECT 1 FROM auditoria_archivo x WHERE x.id = a.id AND x.creado_en = a.creado_en
          )
    `;
    const res = await pool.query(sql, [...params, meses]);
    return res.rowCount;
}

async function asegurarParticionFutura(pool) {
    const anio = new Date().getFullYear() + 1;
    const nombre = `auditoria_${anio}`;
    await pool.query(
        `CREATE TABLE IF NOT EXISTS ${nombre} PARTITION OF auditoria FOR VALUES FROM ('${anio}-01-01') TO ('${anio + 1}-01-01')`
    );
    try {
        await pool.query(`GRANT SELECT, INSERT ON ${nombre} TO compras_app_rw`);
        await pool.query(`REVOKE UPDATE, DELETE, TRUNCATE ON ${nombre} FROM compras_app_rw`);
    } catch (e) {
        console.warn(`[auditoria] No se pudieron aplicar grants restringidos a ${nombre} (¿existe el rol compras_app_rw? ver migración 52):`, e.message);
    }
}

/** Ejecuta una corrida de archivado. Exportado también para poder correrlo manualmente/pruebas. */
export async function ejecutarArchivadoAuditoria(pool, registrarLog) {
    await asegurarParticionFutura(pool);

    let total = 0;
    total += await archivarPorTipo(pool, 'a.tipo_log = $1', ['tecnico'], RETENCION_MESES_TECNICO);
    total += await archivarPorTipo(pool, 'a.tipo_log = $1', ['acceso'], RETENCION_MESES_ACCESO);
    total += await archivarPorTipo(pool, "a.tipo_log NOT IN ('tecnico','acceso')", [], RETENCION_MESES_DEFAULT);

    await registrarLog({
        tipo_log: 'tecnico', modulo: 'auditoria', tabla: 'auditoria_archivo',
        registro_id: '00000000-0000-0000-0000-000000000004', accion: 'INSERT',
        descripcion: `Archivado automático de auditoría: ${total} registro(s) copiados a auditoria_archivo (sin borrar de auditoria).`,
        resultado: 'exitoso',
    });

    return total;
}

/** @param {import('pg').Pool} pool */
export function iniciarArchivadoAuditoria(pool, registrarLog) {
    // Diario a las 3:00am — mismo estilo de cron que ya usa routes/firmas.js
    cron.schedule('0 3 * * *', async () => {
        try {
            const total = await ejecutarArchivadoAuditoria(pool, registrarLog);
            if (total > 0) console.log(`[auditoria] Archivado automático: ${total} registro(s).`);
        } catch (e) {
            console.error('[auditoria] Error en archivado automático de auditoría:', e.message);
        }
    });
}
