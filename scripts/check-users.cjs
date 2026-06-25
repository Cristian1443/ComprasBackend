const pg = require('pg');
const pool = new pg.Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

async function checkUsers() {
    try {
        const res = await pool.query("SELECT id, nombre, email, rol FROM usuarios");
        console.log(JSON.stringify(res.rows, null, 2));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

checkUsers();
