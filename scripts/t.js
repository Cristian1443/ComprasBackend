import pg from 'pg';
const {Pool} = pg;
const pool=new Pool({connectionString:'postgres://postgres:1443@localhost:5432/compras_db'});
pool.query('SELECT id, gerencia_id FROM usuarios LIMIT 1').then(u=>{
    pool.query(`
        INSERT INTO solicitudes (
            solicitante_id, gerencia_id, justificacion, descripcion_necesidad, descripcion_necesidad_detalle, objeto,
            lugar_ejecucion, plazo_ejecucion_meses, plazo_ejecucion_dias,
            modalidad, valor_estimado, moneda,
            valor_moneda_cop, valor_moneda_usd, valor_moneda_eur,
            efecto_estimar_presupuesto, forma_pago, rubro_presupuestal,
            criterios_contratacion, fecha_comite, modalidad_seleccion, justificacion_cd,
            supervision_id, entregables, anexos_texto, anexos_solicitante, riesgos, criterios_ambientales_sst, conclusiones_comite,
            estado
        ) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,nullif($19,'')::date,$20,$21,$22,$23,$24,$25,$26,$27,$28,'borrador')
        RETURNING id
    `, [
        u.rows[0].id, u.rows[0].gerencia_id, 'j','dd','o','le',0,0,'mod',100,'COP',100,0,0,'ef','fp','rp','cc','','ms','jcd',null,'en','at','[]','ri','ca','cc'
    ]).then(console.log).catch(console.error).finally(()=>pool.end());
});
