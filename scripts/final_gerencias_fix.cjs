const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

const sql = `
-- 1. Limpiar y establecer las 5 gerencias oficiales
TRUNCATE gerencias CASCADE;
INSERT INTO gerencias (nombre, codigo) VALUES
('Gerencia Administrativa y Financiera', 'GAF'),
('Gerencia de Mercadeo y Comunicaciones', 'GMC'),
('Gerencia de Promocion e Inversion', 'GPI'),
('Gerencia de Apoyo Estrategico', 'GAE'),
('Gerencia Bureau de Convenciones', 'GBC');

-- 2. Asegurar que los rubros tengan la columna gerencia_nombre
ALTER TABLE rubros_presupuestales ADD COLUMN IF NOT EXISTS gerencia_nombre VARCHAR(150);

-- 3. Limpiar cualquier gerencia antigua en los rubros
UPDATE rubros_presupuestales SET gerencia_nombre = NULL;

-- 4. Vincular rubros a las 5 gerencias oficiales (distribución lógica)
UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia Administrativa y Financiera' 
WHERE codigo LIKE '2.1.1%' OR codigo LIKE '2.1.2%' OR codigo LIKE '2.1.4%';

UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia de Mercadeo y Comunicaciones' 
WHERE codigo LIKE '2.1.3%';

UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia de Promocion e Inversion' 
WHERE codigo LIKE '2.1.5%' OR codigo LIKE '2.2.1.01' OR codigo LIKE '2.2.1.03';

UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia de Apoyo Estrategico' 
WHERE codigo LIKE '2.1.6%' OR codigo LIKE '2.2.1.02';

UPDATE rubros_presupuestales SET gerencia_nombre = 'Gerencia Bureau de Convenciones' 
WHERE gerencia_nombre IS NULL;
`;

async function run() {
    try {
        await pool.query(sql);
        console.log('Base de datos actualizada con las 5 gerencias oficiales.');
    } catch (err) {
        console.error('Error al actualizar:', err);
    } finally {
        await pool.end();
    }
}

run();
