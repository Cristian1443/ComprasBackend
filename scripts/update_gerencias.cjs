const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

const sql = `
-- Limpiar gerencias antiguas (si no tienen solicitudes vinculadas que lo impidan)
-- O simplemente actualizar las existentes y añadir las faltantes.

TRUNCATE gerencias CASCADE;

INSERT INTO gerencias (nombre, codigo) VALUES
('Gerencia Administrativa y Financiera', 'GAF'),
('Gerencia de Mercadeo y Comunicaciones', 'GMC'),
('Gerencia de Promoción e Inversión', 'GPI'),
('Gerencia de Apoyo Estratégico', 'GAE'),
('Gerencia Bureau de Convenciones', 'GBC');
`;

async function run() {
    try {
        await pool.query(sql);
        console.log('Gerencias actualizadas exitosamente.');
    } catch (err) {
        console.error('Error al actualizar gerencias:', err);
    } finally {
        await pool.end();
    }
}

run();
