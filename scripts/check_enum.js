// api/check_enum.js
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

async function check() {
    try {
        const res = await pool.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'rol_usuario'");
        console.log('Roles actuales:', res.rows.map(r => r.enumlabel));
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
check();
