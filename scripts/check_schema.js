import pg from 'pg';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config();

const pool = new pg.Pool({
    user: process.env.DB_USER || 'postgres',
    host: process.env.DB_HOST || 'localhost',
    database: process.env.DB_NAME || 'compras_db',
    password: process.env.DB_PASSWORD || '1443',
    port: process.env.DB_PORT || 5432,
});

async function checkSchema() {
    try {
        const res = await pool.query(`
            SELECT table_name, column_name, data_type 
            FROM information_schema.columns 
            WHERE table_name IN ('solicitudes', 'v_solicitudes_resumen')
            ORDER BY table_name, ordinal_position;
        `);

        let output = '';
        const tables = {};
        res.rows.forEach(row => {
            if (!tables[row.table_name]) tables[row.table_name] = [];
            tables[row.table_name].push(`${row.column_name} (${row.data_type})`);
        });

        for (const [table, columns] of Object.entries(tables)) {
            output += `--- TABLE/VIEW: ${table} ---\n`;
            columns.forEach(c => output += `${c}\n`);
            output += `\n`;
        }

        fs.writeFileSync('schema_output.txt', output);
        console.log('Schema output written to schema_output.txt');

    } catch (err) {
        console.error('Error checking schema:', err);
    } finally {
        await pool.end();
    }
}

checkSchema();
