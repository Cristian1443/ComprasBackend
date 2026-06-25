import pg from 'pg';
const pool = new pg.Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'compras_db',
    password: '1443',
    port: 5432
});

async function run() {
    try {
        const res = await pool.query(`
            SELECT u.email, u.nombre, u.gerencia_id, g.nombre as gerencia_nombre 
            FROM usuarios u 
            LEFT JOIN gerencias g ON u.gerencia_id = g.id 
            WHERE u.email = 'pasantedesarrollo@investinbogota.org'
        `);
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
