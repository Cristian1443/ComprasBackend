const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'compras_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '1443',
});

async function runMigration() {
    try {
        const sqlPath = path.join(__dirname, '..', 'database', '12_audit_inserts.sql');
        const sql = fs.readFileSync(sqlPath, 'utf8');

        console.log('Ejecutando migración 12_audit_inserts.sql...');
        await pool.query(sql);
        console.log('Migración 12 completada con éxito.');
    } catch (err) {
        console.error('Error ejecutando migración:', err);
    } finally {
        pool.end();
    }
}

runMigration();
