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

// 40 se salta: ALTER TABLE sobre entregables_supervisor/informes_supervision_contrato
// que no son creadas por ninguna migración existente.
const SKIP = new Set(['00_install.sql', '04_security.sql', '40_fecha_completado_supervision.sql']);

async function runFile(file, migrationsDir) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    await pool.query(sql);
}

async function runMigrations() {
    const migrationsDir = path.join(__dirname, '..', 'database', 'migrations');

    const allFiles = fs.readdirSync(migrationsDir)
        .filter(f => f.endsWith('.sql') && !SKIP.has(f))
        .sort((a, b) => {
            const numA = parseInt(a.match(/^(\d+)/)?.[1] ?? '999', 10);
            const numB = parseInt(b.match(/^(\d+)/)?.[1] ?? '999', 10);
            return numA - numB;
        });

    const ordered = allFiles;

    console.log(`Ejecutando ${ordered.length} migraciones (${SKIP.size} omitidas)...\n`);

    const failed = [];

    for (const file of ordered) {
        try {
            await runFile(file, migrationsDir);
            console.log(`✓ ${file}`);
        } catch (err) {
            const msg = err.message.split('\n')[0];
            console.warn(`⚠  ${file} — ${msg}`);
            failed.push({ file, msg });
        }
    }

    if (failed.length > 0) {
        console.log(`\n--- Reintentando ${failed.length} fallidas ---\n`);
        const stillFailed = [];
        for (const { file } of failed) {
            try {
                await runFile(file, migrationsDir);
                console.log(`✓ ${file} (reintento OK)`);
            } catch (err) {
                const msg = err.message.split('\n')[0];
                console.error(`✗ ${file} — ${msg}`);
                stillFailed.push({ file, msg });
            }
        }
        if (stillFailed.length > 0) {
            console.log('\nFallaron definitivamente:');
            stillFailed.forEach(({ file, msg }) => console.log(`  - ${file}: ${msg}`));
        } else {
            console.log('\nTodas las migraciones completadas tras reintento.');
        }
    } else {
        console.log('\nTodas las migraciones completadas.');
    }

    await pool.end();
}

runMigrations();
