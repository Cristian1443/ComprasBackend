const { Pool } = require('pg');

const pool = new Pool({
    host: 'localhost',
    port: 5432,
    database: 'compras_db',
    user: 'postgres',
    password: '1443'
});

async function run() {
    try {
        await pool.query(`
            INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
            VALUES 
            ('dev-cristian', 'pasantedesarrollo@investinbogota.org', 'Cristian Johan Reyes Gutierrez', 'Pasante Desarrollo', (SELECT id FROM gerencias WHERE codigo = 'GAF'), 'administrador'),
            ('eduar-rincon', 'gestiondocumental@investinbogota.org', 'Eduar Rincon Amortegui', 'Gestión Documental', (SELECT id FROM gerencias WHERE codigo = 'GAF'), 'supervisor')
            ON CONFLICT (email) DO UPDATE SET gerencia_id = EXCLUDED.gerencia_id, rol = EXCLUDED.rol;
        `);

        const cristianIdRes = await pool.query("SELECT id FROM usuarios WHERE email = 'pasantedesarrollo@investinbogota.org'");
        const eduarIdRes = await pool.query("SELECT id FROM usuarios WHERE email = 'gestiondocumental@investinbogota.org'");
        
        const gafIdRes = await pool.query("SELECT id FROM gerencias WHERE codigo = 'GAF'");
        const gpiGerIdRes = await pool.query("SELECT id FROM gerencias WHERE codigo = 'GPI'");
        const gmcGerIdRes = await pool.query("SELECT id FROM gerencias WHERE codigo = 'GMC'");
        const gaeGerIdRes = await pool.query("SELECT id FROM gerencias WHERE codigo = 'GAE'");
        const gbcGerIdRes = await pool.query("SELECT id FROM gerencias WHERE codigo = 'GBC'");

        if (gafIdRes.rows.length > 0 && cristianIdRes.rows.length > 0) {
            const cristianId = cristianIdRes.rows[0].id;
            const eduarId = eduarIdRes.rows[0].id;
            const gafId = gafIdRes.rows[0].id;
            const gpiId = gpiGerIdRes.rows[0].id;
            const gmcId = gmcGerIdRes.rows[0].id;
            const gaeId = gaeGerIdRes.rows[0].id;
            const gbcId = gbcGerIdRes.rows[0].id;

            const solicitudes = [
                ['SOL-2026-0045', 'Servicios de Consultoría Estratégica GPI', cristianId, gpiId, 'en_financiera', 15000000],
                ['SOL-2026-0046', 'Compra de Equipos de Cómputo - GAF', eduarId, gafId, 'en_financiera', 8500000],
                ['SOL-2026-0047', 'Suministro de Licencias Microsoft 365', cristianId, gafId, 'borrador', 4200000],
                ['SOL-2026-0048', 'Compra de Deshumidificador para Archivo Central', eduarId, gafId, 'en_financiera', 2500000],
                ['SOL-2026-0049', 'Servicio de Catering Evento Inversión', cristianId, gpiId, 'aprobado_gerente', 1800000],
                ['SOL-2026-0050', 'Mantenimiento Preventivo Aires Acondicionados', eduarId, gafId, 'en_financiera', 3500000],
                ['SOL-2026-0051', 'Diseño de Campaña de Marca Ciudad 2026', cristianId, gmcId, 'enviado_gerente', 12000000],
                ['SOL-2026-0052', 'Auditoría Externa Estados Financieros', eduarId, gafId, 'aprobado_gerente', 9000000],
                ['SOL-2026-0053', 'Suministro de Papelería y Útiles de Oficina', eduarId, gafId, 'borrador', 800000],
                ['SOL-2026-0054', 'Renovación de Seguros Multiriesgo Corporativo', cristianId, gafId, 'en_juridica', 22000000],
                ['SOL-2026-0055', 'Contratación de Servicios de Limpieza y Aseo', eduarId, gafId, 'enviado_gerente', 5000000],
                ['SOL-2026-0056', 'Desarrollo de Plataforma Web de Inversionistas', cristianId, gaeId, 'en_financiera', 45000000],
                ['SOL-2026-0057', 'Tiquetes Aéreos Misión Internacional Londres', cristianId, gpiId, 'borrador', 7500000],
                ['SOL-2026-0058', 'Servicios de Seguridad Privada Sedes', eduarId, gafId, 'en_juridica', 18000000],
                ['SOL-2026-0059', 'Suministro de Café y Cafetería Mensual', eduarId, gafId, 'aprobado_gerente', 450000]
            ];

            for (const s of solicitudes) {
                await pool.query(`
                    INSERT INTO solicitudes (codigo, objeto, solicitante_id, gerencia_id, estado, valor_estimado, creado_en)
                    VALUES ($1, $2, $3, $4, $5, $6, NOW() - INTERVAL '${Math.floor(Math.random() * 10)} days')
                    ON CONFLICT (codigo) DO NOTHING;
                `, s);
            }
            console.log('Restauración completada satisfactoriamente.');
        }
    } catch (err) {
        console.error(err);
    } finally {
        await pool.end();
    }
}

run();
