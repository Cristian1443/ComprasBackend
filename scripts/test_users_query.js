// api/test_users_query.js
import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'compras_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '1443',
});

async function test() {
    try {
        const result = await pool.query(
            `SELECT u.id, u.nombre, u.email, u.cargo, g.nombre AS gerencia_nombre, u.activo
             FROM usuarios u
             LEFT JOIN gerencias g ON u.gerencia_id = g.id
             ORDER BY u.nombre`
        );
        console.log('Total usuarios en DB:', result.rows.length);
        console.log('Primeros 5:', result.rows.slice(0, 5));
        console.log('Usuarios inactivos:', result.rows.filter(u => !u.activo).length);
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
test();
