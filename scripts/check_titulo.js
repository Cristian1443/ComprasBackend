import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({ host: 'localhost', port: 5432, database: 'compras_db', user: 'postgres', password: '1443' });

const client = await pool.connect();
const res = await client.query(`
  SELECT id, codigo, titulo_contrato, objeto, creado_en
  FROM solicitudes
  ORDER BY creado_en DESC
  LIMIT 5
`);
console.log('Últimas 5 solicitudes:');
res.rows.forEach(r => console.log(`  ${r.codigo} | titulo_contrato="${r.titulo_contrato}" | objeto="${r.objeto?.slice(0,30)}"`));
client.release();
await pool.end();
