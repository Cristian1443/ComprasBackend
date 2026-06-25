/**
 * Migración: agrega columnas para cotización/plazo en proponentes
 * y analisis_plazo_promedio_meses/dias en solicitudes.
 */
const { Pool } = require('pg');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME     || 'compras_db',
  user:     process.env.DB_USER     || 'postgres',
  password: process.env.DB_PASSWORD || '1443',
});

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 1. Columnas en tabla proponentes
    await client.query(`
      ALTER TABLE proponentes
        ADD COLUMN IF NOT EXISTS valor_cotizacion TEXT,
        ADD COLUMN IF NOT EXISTS plazo_meses INTEGER,
        ADD COLUMN IF NOT EXISTS plazo_dias INTEGER;
    `);
    console.log('✅ proponentes: valor_cotizacion, plazo_meses, plazo_dias agregados');

    // 2. Columnas en tabla solicitudes
    await client.query(`
      ALTER TABLE solicitudes
        ADD COLUMN IF NOT EXISTS analisis_plazo_promedio_meses INTEGER,
        ADD COLUMN IF NOT EXISTS analisis_plazo_promedio_dias INTEGER,
        ADD COLUMN IF NOT EXISTS justificacion_anticipo TEXT,
        ADD COLUMN IF NOT EXISTS obligaciones_especificas JSONB DEFAULT '[]',
        ADD COLUMN IF NOT EXISTS entregables_detalle JSONB DEFAULT '[]';
    `);
    console.log('✅ solicitudes: analisis_plazo_promedio_meses, analisis_plazo_promedio_dias, justificacion_anticipo, obligaciones_especificas, entregables_detalle agregados');

    await client.query('COMMIT');
    console.log('✅ Migración completada exitosamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
