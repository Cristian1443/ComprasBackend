import pg from 'pg';

const pool = new pg.Pool({ 
    host: 'localhost', port: 5432, database: 'compras_db', 
    user: 'postgres', password: '1443' 
});

try {
    const sol = await pool.query("SELECT id, codigo FROM solicitudes WHERE codigo = 'SOL-2026-0039'");
    console.log('SOL:', JSON.stringify(sol.rows));
    
    const sid = sol.rows[0]?.id;
    if (!sid) { console.log('NO ENCONTRADA'); process.exit(0); }

    const props = await pool.query(
        'SELECT numero, nombre_proveedor, datos_contacto, requisitos_tecnicos, experiencia, valor_con_impuestos, valor_agregado FROM proponentes WHERE solicitud_id = $1 ORDER BY numero',
        [sid]
    );
    console.log('\nPROPONENTES (tabla investigacion de mercado):');
    props.rows.forEach(p => console.log(JSON.stringify(p)));

    const invs = await pool.query(
        `SELECT ci.proponente_nombre, ci.proponente_email 
         FROM convocatoria_invitaciones ci 
         JOIN convocatorias c ON ci.convocatoria_id = c.id 
         WHERE c.solicitud_id = $1`,
        [sid]
    );
    console.log('\nINVITACIONES (tabla invitaciones):');
    invs.rows.forEach(i => console.log(JSON.stringify(i)));

} catch(e) {
    console.error('ERROR:', e.message);
}
process.exit(0);
