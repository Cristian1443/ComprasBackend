const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

async function run() {
    try {
        // 1. Insertar a Eduar Rincon
        await pool.query(`
            INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
            VALUES (
                'pending-eduar',
                'gestiondocumental@investinbogota.org',
                'Eduar Rincon Amortegui',
                'Profesional de Gestión Documental',
                (SELECT id FROM gerencias WHERE codigo = 'GAF'),
                'supervisor'
            ) ON CONFLICT (email) DO UPDATE SET nombre = EXCLUDED.nombre;
        `);

        // 2. Reasignar la solicitud
        const eduarRes = await pool.query("SELECT id FROM usuarios WHERE email = 'gestiondocumental@investinbogota.org'");
        if (eduarRes.rows.length > 0) {
            const eduarId = eduarRes.rows[0].id;
            await pool.query("UPDATE solicitudes SET solicitante_id = $1 WHERE objeto LIKE '%Deshumidificador%'", [eduarId]);
            console.log('Usuario Eduar restaurado y solicitud reasignada.');
        }

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
