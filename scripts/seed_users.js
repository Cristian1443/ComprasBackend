// api/seed_users.js
import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const pool = new pg.Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'compras_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '1443',
});

async function runSeed() {
    console.log('🚀 Iniciando carga de funcionarios...');
    const client = await pool.connect();
    try {
        // 1. Agregar el nuevo rol de forma segura
        const rolesRes = await client.query("SELECT enumlabel FROM pg_enum JOIN pg_type ON pg_enum.enumtypid = pg_type.oid WHERE typname = 'rol_usuario'");
        const roles = rolesRes.rows.map(r => r.enumlabel);

        if (!roles.includes('secretaria_comite')) {
            console.log('➕ Agregando rol secretaria_comite...');
            // ALTER TYPE ... ADD VALUE no puede correr en transacciones en algunas versiones
            await client.query("ALTER TYPE rol_usuario ADD VALUE 'secretaria_comite'");
        }

        // 2. Ejecutar el SQL de carga de usuarios
        const sqlPath = path.join(__dirname, '..', 'database', '21_seed_active_users.sql');
        let sql = fs.readFileSync(sqlPath, 'utf8');

        // Quitar el bloque DO ya que lo manejamos arriba
        sql = sql.replace(/DO \$\$[\s\S]*?END \$\$;/g, '-- Rol ya manejado');

        console.log('📝 Sincronizando gerencias y usuarios...');
        await client.query(sql);

        console.log('✅ Carga completa.');
    } catch (err) {
        console.error('❌ Error:', err.message);
    } finally {
        client.release();
        await pool.end();
    }
}

runSeed();
