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
        // Buscar a Eduar Rincon
        const res = await pool.query("SELECT id FROM usuarios WHERE email = 'gestiondocumental@investinbogota.org' OR nombre LIKE '%Eduar%'");
        
        if (res.rows.length > 0) {
            const eduarId = res.rows[0].id;
            // Reasignar el deshumidificador
            await pool.query("UPDATE solicitudes SET solicitante_id = $1 WHERE objeto LIKE '%Deshumidificador%'", [eduarId]);
            console.log('Solicitud reasignada exitosamente a Eduar Rincon.');
        } else {
            console.log('No se encontró al usuario original para reasignar.');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
