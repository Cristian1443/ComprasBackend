const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

const sql = `
-- Añadir columna de gerencia a los rubros
ALTER TABLE rubros_presupuestales ADD COLUMN IF NOT EXISTS gerencia_nombre VARCHAR(150);

-- Actualizar rubros existentes con sus gerencias correspondientes
UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia Administrativa y Financiera' WHERE codigo LIKE '2.1.1%' OR codigo LIKE '2.1.2%' OR codigo LIKE '2.1.4%';
UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia de Mercadeo y Comunicaciones' WHERE codigo LIKE '2.1.3%';
UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia de Promoción e Inversión' WHERE codigo LIKE '2.1.5%' OR codigo LIKE '2.2.1.01' OR codigo LIKE '2.2.1.03';
UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia de Apoyo Estratégico' WHERE codigo LIKE '2.1.6%' OR codigo LIKE '2.2.1.02';
UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia Bureau de Convenciones' WHERE gerencia_nombre IS NULL;
`;

async function run() {
    try {
        await pool.query(sql);
        console.log('Rubros vinculados con gerencias exitosamente.');
    } catch (err) {
        console.error('Error al vincular rubros:', err);
    } finally {
        await pool.end();
    }
}

run();
