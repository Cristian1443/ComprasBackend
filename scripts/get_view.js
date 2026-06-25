import pg from 'pg';
const { Pool } = pg;
const pool = new Pool({ host: 'localhost', port: 5432, database: 'compras_db', user: 'postgres', password: '1443' });
const client = await pool.connect();
const res = await client.query(`SELECT definition FROM pg_views WHERE viewname = 'v_solicitudes_resumen'`);
console.log(res.rows[0]?.definition || 'Vista no encontrada');
client.release();
await pool.end();
