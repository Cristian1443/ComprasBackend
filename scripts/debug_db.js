import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'compras_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '1443',
});

async function check() {
    try {
        const enumRes = await pool.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'estado_solicitud'");
        console.log('Estados (enum):', enumRes.rows.map(r => r.enumlabel));

        const sampleRes = await pool.query("SELECT id, codigo, estado, solicitante_id FROM solicitudes LIMIT 10");
        console.log('Sample solicitudes:', JSON.stringify(sampleRes.rows, null, 2));

        const viewRes = await pool.query("SELECT id, codigo, estado, solicitante_email FROM v_solicitudes_resumen LIMIT 10");
        console.log('Sample view rows:', JSON.stringify(viewRes.rows, null, 2));

    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}
check();
