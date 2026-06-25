const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5432,
  database: 'compras_db',
  user: 'postgres',
  password: '1443'
});

async function verificar() {
  const client = await pool.connect();
  try {
    console.log('Verificando solicitudes con criterios_contratacion...');
    
    const solicitudes = await client.query(`
      SELECT id, objeto, criterios_contratacion 
      FROM solicitudes 
      ORDER BY creado_en DESC
      LIMIT 5
    `);
    
    console.log('Últimas solicitudes:');
    solicitudes.rows.forEach(s => {
      console.log(`- ID: ${s.id}`);
      console.log(`  Objeto: ${s.objeto}`);
      console.log(`  Criterios: ${s.criterios_contratacion ? s.criterios_contratacion.substring(0, 50) + '...' : 'NULL'}`);
      console.log('');
    });
    
  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

verificar();
