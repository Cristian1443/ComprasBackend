import pg from 'pg';
const pool = new pg.Pool({ connectionString: 'postgres://postgres:1443@localhost:5432/compras_db' });
const gid = 'bfa1abd1-9b3c-4ae5-a939-14d7b71ed267';
const email = 'pasantedesarrollo@investinbogota.org';

async function run() {
    try {
        await pool.query("DELETE FROM solicitudes WHERE codigo LIKE 'SOL-2024-DEMO%'");

        await pool.query(`
            INSERT INTO solicitudes (codigo, objeto, valor_estimado, valor_en_cop, moneda, estado, solicitante_id, gerencia_id, creado_en, actualizado_en)
            SELECT 'SOL-2024-DEMO1', 'Mantenimiento preventivo servidores', 15000000, 15000000, 'COP', 'enviado_gerente', id, $1, NOW() - INTERVAL '1 day', NOW()
            FROM usuarios WHERE email = $2
        `, [gid, email]);

        await pool.query(`
            INSERT INTO solicitudes (codigo, objeto, valor_estimado, valor_en_cop, moneda, estado, solicitante_id, gerencia_id, creado_en, actualizado_en)
            SELECT 'SOL-2024-DEMO2', 'Licenciamiento Software CRM', 45000000, 45000000, 'COP', 'enviado_gerente', id, $1, NOW() - INTERVAL '2 days', NOW()
            FROM usuarios WHERE email = $2
        `, [gid, email]);

        await pool.query(`
            INSERT INTO solicitudes (codigo, objeto, valor_estimado, valor_en_cop, moneda, estado, solicitante_id, gerencia_id, creado_en, actualizado_en)
            SELECT 'SOL-2024-DEMO3', 'Capacitación Ciberseguridad', 12000000, 12000000, 'COP', 'aprobado_financiera', id, $1, NOW() - INTERVAL '1 month', NOW()
            FROM usuarios WHERE email = $2
        `, [gid, email]);

        console.log('Sample data created successfully');
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}

run();
