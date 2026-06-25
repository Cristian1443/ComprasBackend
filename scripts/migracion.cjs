const { Pool } = require('pg');

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
    console.log('Iniciando migración completa...\n');
    await client.query('BEGIN');
    
    // 1. Eliminar vistas que dependen de moneda
    console.log('1. Eliminando vistas dependientes...');
    await client.query('DROP VIEW IF EXISTS v_proponentes_solicitud');
    await client.query('DROP VIEW IF EXISTS v_solicitudes_resumen');
    console.log('   ✓ Vistas eliminadas');
    
    // 2. Eliminar restricciones
    console.log('2. Eliminando restricciones...');
    await client.query('ALTER TABLE solicitudes DROP CONSTRAINT IF EXISTS solicitudes_moneda_not_null');
    console.log('   ✓ Restricciones eliminadas');
    
    // 3. Modificar moneda en solicitudes
    console.log('3. Modificando columna moneda en solicitudes...');
    await client.query(`ALTER TABLE solicitudes ADD COLUMN moneda_nueva TEXT`);
    await client.query(`UPDATE solicitudes SET moneda_nueva = 'COP' WHERE moneda IS NULL`);
    await client.query(`UPDATE solicitudes SET moneda_nueva = moneda::TEXT WHERE moneda IS NOT NULL`);
    await client.query(`ALTER TABLE solicitudes DROP COLUMN moneda`);
    await client.query(`ALTER TABLE solicitudes RENAME COLUMN moneda_nueva TO moneda`);
    await client.query(`ALTER TABLE solicitudes ALTER COLUMN moneda SET DEFAULT 'COP'`);
    await client.query(`ALTER TABLE solicitudes ALTER COLUMN moneda SET NOT NULL`);
    console.log('   ✓ moneda cambiada a TEXT');
    
    // 4. Modificar moneda en proponentes
    console.log('4. Modificando columna moneda en proponentes...');
    await client.query(`ALTER TABLE proponentes ADD COLUMN moneda_nueva TEXT`);
    await client.query(`UPDATE proponentes SET moneda_nueva = 'COP' WHERE moneda IS NULL`);
    await client.query(`UPDATE proponentes SET moneda_nueva = moneda::TEXT WHERE moneda IS NOT NULL`);
    await client.query(`ALTER TABLE proponentes DROP COLUMN moneda`);
    await client.query(`ALTER TABLE proponentes RENAME COLUMN moneda_nueva TO moneda`);
    await client.query(`ALTER TABLE proponentes ALTER COLUMN moneda SET DEFAULT 'COP'`);
    console.log('   ✓ moneda en proponentes cambiada a TEXT');
    
    // 5. Modificar plazos
    console.log('5. Modificando plazo_desde...');
    await client.query(`ALTER TABLE solicitudes ADD COLUMN plazo_desde_nuevo TEXT`);
    await client.query(`UPDATE solicitudes SET plazo_desde_nuevo = plazo_desde::TEXT WHERE plazo_desde IS NOT NULL`);
    await client.query(`ALTER TABLE solicitudes DROP COLUMN plazo_desde`);
    await client.query(`ALTER TABLE solicitudes RENAME COLUMN plazo_desde_nuevo TO plazo_desde`);
    console.log('   ✓ plazo_desde cambiado a TEXT');
    
    console.log('6. Modificando plazo_hasta...');
    await client.query(`ALTER TABLE solicitudes ADD COLUMN plazo_hasta_nuevo TEXT`);
    await client.query(`UPDATE solicitudes SET plazo_hasta_nuevo = plazo_hasta::TEXT WHERE plazo_hasta IS NOT NULL`);
    await client.query(`ALTER TABLE solicitudes DROP COLUMN plazo_hasta`);
    await client.query(`ALTER TABLE solicitudes RENAME COLUMN plazo_hasta_nuevo TO plazo_hasta`);
    console.log('   ✓ plazo_hasta cambiado a TEXT');
    
    // 7. Recrear vistas
    console.log('7. Recreando vistas...');
    await client.query(`
      CREATE OR REPLACE VIEW v_solicitudes_resumen AS
      SELECT 
        s.id, s.codigo, s.version, s.estado, s.prioridad,
        s.objeto, s.justificacion, s.lugar_ejecucion,
        s.plazo_desde, s.plazo_hasta,
        s.modalidad, s.valor_estimado, s.moneda,
        s.efecto_estimar_presupuesto, s.forma_pago,
        s.criterios_contratacion,
        u.nombre as solicitante, u.email as solicitante_email,
        g.nombre as gerencia,
        s.creado_en, s.actualizado_en
      FROM solicitudes s
      LEFT JOIN usuarios u ON s.solicitante_id = u.id
      LEFT JOIN gerencias g ON s.gerencia_id = g.id
    `);
    console.log('   ✓ v_solicitudes_resumen recreada');
    
    await client.query(`
      CREATE OR REPLACE VIEW v_proponentes_solicitud AS
      SELECT 
        p.id as proponente_id,
        p.numero,
        p.nombre_proveedor,
        p.datos_contacto,
        p.requisitos_tecnicos,
        p.experiencia,
        p.criterios_habilitantes,
        p.valor_con_impuestos,
        p.moneda,
        p.observaciones,
        p.seleccionado,
        s.id as solicitud_id,
        s.codigo as solicitud_codigo,
        s.objeto as solicitud_objeto
      FROM proponentes p
      JOIN solicitudes s ON p.solicitud_id = s.id
    `);
    console.log('   ✓ v_proponentes_solicitud recreada');
    
    await client.query('COMMIT');
    console.log('\n✓✓✓ MIGRACIÓN COMPLETADA EXITOSAMENTE ✓✓✓');
    
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('\n✗ Error:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrar();
