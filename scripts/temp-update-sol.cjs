const pg = require('pg');
const pool = new pg.Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

async function update() {
    try {
        const res = await pool.query("UPDATE solicitudes SET estado = 'enviado_gerente' WHERE codigo = 'SOL-2026-0004' RETURNING id, estado");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

update();
