-- 21_seed_active_users.sql
-- Carga masiva de funcionarios activos según imagen proporcionada

-- 1. Asegurar que el rol 'secretaria_comite' exista
DO $$ 
BEGIN 
    IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_enum e ON t.oid = e.enumtypid WHERE t.typname = 'rol_usuario' AND e.enumlabel = 'secretaria_comite') THEN
        ALTER TYPE rol_usuario ADD VALUE 'secretaria_comite';
    END IF;
END $$;

-- 2. Asegurar que las gerencias tengan los nombres/códigos que vienen del Azure AD/Imagen
UPDATE gerencias SET nombre = 'MERCADEO' WHERE codigo = 'GMC';
UPDATE gerencias SET nombre = 'GAF' WHERE codigo = 'GAF';
UPDATE gerencias SET nombre = 'GAE' WHERE codigo = 'GAE';
UPDATE gerencias SET nombre = 'GPDI' WHERE codigo = 'GPI';
UPDATE gerencias SET nombre = 'BUREAU' WHERE codigo = 'GBC';
UPDATE gerencias SET nombre = 'D.E' WHERE codigo = 'DE';

-- 3. Inserción de usuarios
-- Se usa email como llave única. El azure_id se genera temporalmente y se actualizará al login.

INSERT INTO usuarios (azure_id, email, nombre, cargo, gerencia_id, rol)
VALUES 
('temp-1',  'apabril@investinbogota.org', 'ABRIL CUERVO ANDREA PATRICIA', 'Funcionario de Mercadeo', (SELECT id FROM gerencias WHERE nombre = 'MERCADEO'), 'supervisor'),
('temp-2',  'johjagudelo@investinbogota.org', 'AGUDELO VALENCIA JOHANA MARCELA', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-3',  'jbarragan@investinbogota.org', 'BARRAGAN JOSE NICOLAS', 'Funcionario GAE', (SELECT id FROM gerencias WHERE nombre = 'GAE'), 'supervisor'),
('temp-4',  'jcabrera@investinbogota.org', 'CABRERA SILVA JENNY JASMIN', 'Funcionario GAE', (SELECT id FROM gerencias WHERE nombre = 'GAE'), 'supervisor'),
('temp-5',  'gcardenas@investinbogota.org', 'CARDENAS PEREZ GABRIELA', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-6',  'vcardenas@investinbogota.org', 'CARDENAS PINZON VALERIA', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-7',  'ncaselles@investinbogota.org', 'CASELLES RINCÓN NADIA KAMILA', 'Funcionario Bureau', (SELECT id FROM gerencias WHERE nombre = 'BUREAU'), 'supervisor'),
('temp-8',  'gestionhumana@investinbogota.org', 'CHACON PINEDA ALIX AYDA', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-9',  'ddiaz@investinbogota.org', 'DIAZ SANCHEZ DEISY', 'Secretaria de Comité', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'secretaria_comite'),
('temp-10', 'fdiaz@investinbogota.org', 'DIAZ TORO FERNADO HUMBERTO', 'Funcionario de Mercadeo', (SELECT id FROM gerencias WHERE nombre = 'MERCADEO'), 'supervisor'),
('temp-11', 'sespinosa@investinbogota.org', 'ESPINOSA MENESES SAMUEL', 'Analista Financiero', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'financiera'),
('temp-12', 'lfajardo@investinbogota.org', 'FAJARDO GOMEZ LUZ EDIT', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-13', 'afigueroa@investinbogota.org', 'FIGUEROA RODRIGUEZ ANDREA CATALINA', 'Funcionario de Mercadeo', (SELECT id FROM gerencias WHERE nombre = 'MERCADEO'), 'supervisor'),
('temp-14', 'lgarcia@investinbogota.org', 'GARCIA ACEVEDO LINA MARCELA', 'Funcionario de Mercadeo', (SELECT id FROM gerencias WHERE nombre = 'MERCADEO'), 'supervisor'),
('temp-15', 'dgarcia@investinbogota.org', 'GARCIA DURAN DANIELA', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-16', 'jgiraldo@investinbogota.org', 'GIRALDO VASQUEZ JUAN SEBASTIAN', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-17', 'jgomezp@investinbogota.org', 'GOMEZ PELAEZ JULIANA', 'Gerente D.E', (SELECT id FROM gerencias WHERE nombre = 'D.E'), 'gerente_area'),
('temp-18', 'agonzalez@investinbogota.org', 'GONZALEZ CASTRO ADRIANA MARCELA', 'Gerente de Mercadeo', (SELECT id FROM gerencias WHERE nombre = 'MERCADEO'), 'gerente_area'),
('temp-19', 'aehernandez@investinbogota.org', 'HERNANDEZ HERNANDEZ ANA EMILET', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-20', 'minfante@investinbogota.org', 'INFANTE MARTINEZ MARIA JOSE', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-21', 'vmartinez@investinbogota.org', 'MARTINEZ QUINTERO VALERIA', 'Funcionario Bureau', (SELECT id FROM gerencias WHERE nombre = 'BUREAU'), 'supervisor'),
('temp-22', 'amejia@investinbogota.org', 'MEJIA PLAZAS ALEJANDRA', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-23', 'cmontana@investinbogota.org', 'MONTAÑA CAMARGO CATALINA', 'Funcionario Bureau', (SELECT id FROM gerencias WHERE nombre = 'BUREAU'), 'supervisor'),
('temp-24', 'amontana@investinbogota.org', 'MONTAÑA ORJUELA ANDREA', 'Funcionario GAE', (SELECT id FROM gerencias WHERE nombre = 'GAE'), 'supervisor'),
('temp-25', 'imonterrey@investinbogota.org', 'MONTEREY ARANDA IVANOFF', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-26', 'lmorales@investinbogota.org', 'MORALES ARISTIZABAL LUIS FELIPE', 'Funcionario Bureau', (SELECT id FROM gerencias WHERE nombre = 'BUREAU'), 'supervisor'),
('temp-27', 'recepcion@investinbogota.org', 'OSPINA MOYA DANIELA', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-28', 'jpena@investinbogota.org', 'PEÑA TORRES KAREN JULIANA', 'Gerente GAE', (SELECT id FROM gerencias WHERE nombre = 'GAE'), 'gerente_area'),
('temp-29', 'mpineda@investinbogota.org', 'PINEDA VARGAS MICHAEL STEVE', 'Funcionario GAE', (SELECT id FROM gerencias WHERE nombre = 'GAE'), 'supervisor'),
('temp-30', 'jpinzon@investinbogota.org', 'PINZON JUAN FELIPE', 'Funcionario GAE', (SELECT id FROM gerencias WHERE nombre = 'GAE'), 'supervisor'),
('temp-31', 'gestiondocumental@investinbogota.org', 'RINCON AMORTEGUI EDUAR', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-32', 'jrojas@investinbogota.org', 'ROJAS JOSE LUIS', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-33', 'csanchez@investinbogota.org', 'SANCHEZ CARLOS', 'Gerente GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'gerente_area'),
('temp-34', 'mcardona@investinbogota.org', 'SANCHEZ CARDONA JULIETH MARCELA', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-35', 'lsandoval@investinbogota.org', 'SANDOVAL LINA PAOLA', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-36', 'fsolano@investinbogota.org', 'SOLANO OLARTE FRANSISCO', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-37', 'ctamayo@investinbogota.org', 'TAMAYO SANDRA CAROLINA', 'Funcionario GPDI', (SELECT id FROM gerencias WHERE nombre = 'GPDI'), 'supervisor'),
('temp-38', 'ltibaduisa@investinbogota.org', 'TIBADUIZA LEON LUIS ALEJANDRO', 'Funcionario de Mercadeo', (SELECT id FROM gerencias WHERE nombre = 'MERCADEO'), 'supervisor'),
('temp-39', 'ltobon@investinbogota.org', 'TOBON ARANGO LAURA', 'Abogada de Contratación', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'juridica'),
('temp-40', 'lvanoy@investinbogota.org', 'VANOY ESPITIA LUZ ALEYDA', 'Funcionario GAF', (SELECT id FROM gerencias WHERE nombre = 'GAF'), 'supervisor'),
('temp-41', 'lvasquez@investinbogota.org', 'VASQUEZ VERGARA LUISA FERNANDA', 'Gerente Bureau', (SELECT id FROM gerencias WHERE nombre = 'BUREAU'), 'gerente_area'),
('temp-42', 'mvergara@investinbogota.org', 'VERGARA GARCIA MARIA ALEJANDRA', 'Funcionario Bureau', (SELECT id FROM gerencias WHERE nombre = 'BUREAU'), 'supervisor')
ON CONFLICT (email) DO UPDATE SET
    nombre = EXCLUDED.nombre,
    rol = EXCLUDED.rol,
    gerencia_id = EXCLUDED.gerencia_id,
    cargo = EXCLUDED.cargo;
