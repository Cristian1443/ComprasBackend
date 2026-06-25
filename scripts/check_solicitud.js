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
            SELECT s.codigo, s.solicitante_id, s.gerencia_id, s.estado 
            FROM solicitudes s 
            ORDER BY s.codigo DESC LIMIT 5;
        `);
        console.log('Last Solicitudes:', JSON.stringify(res.rows, null, 2));

        const userRes = await pool.query(`
            SELECT id, email, gerencia_id FROM usuarios WHERE email = 'pasantedesarrollo@investinbogota.org'
        `);
        console.log('Valid User:', JSON.stringify(userRes.rows, null, 2));

        console.log(JSON.stringify(res.rows, null, 2));
    } catch (e) {
        console.error(e);
    } finally {
        await pool.end();
    }
}
run();
