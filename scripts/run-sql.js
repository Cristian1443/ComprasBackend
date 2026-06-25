import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const { Pool } = pg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, '.env') });

const pool = new Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'compras_db',
    password: process.env.DB_PASSWORD || '1443',
    port: process.env.DB_PORT || 5432,
});

async function run() {
    const filename = process.argv[2] || '../database/10_update_view_gerencia.sql';
    try {
        const sqlPath = path.isAbsolute(filename) ? filename : path.join(__dirname, filename);
        const sql = fs.readFileSync(sqlPath, 'utf8');
        console.log(`Running ${path.basename(sqlPath)}...`);
        await pool.query(sql);
        console.log('SQL executed successfully.');
    } catch (err) {
        console.error('Error executing SQL:', err);
    } finally {
        await pool.end();
    }
}

run();
