import pg from 'pg';
const { Pool } = pg;

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'compras_db',
  user: 'postgres',
  password: '1443'
});

async function migrar() {
  const client = await pool.connect();
  try {
    await client.query(`ALTER TABLE solicitudes ADD COLUMN IF NOT EXISTS titulo_contrato TEXT`);
    console.log('✓ Columna titulo_contrato agregada correctamente');

    const res = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_name = 'solicitudes' AND column_name = 'titulo_contrato'
    `);
    if (res.rows.length > 0) {
      console.log('✓ Verificación OK: columna existe en la tabla solicitudes');
    } else {
      console.log('✗ La columna no fue creada — revisar permisos');
    }
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrar();
