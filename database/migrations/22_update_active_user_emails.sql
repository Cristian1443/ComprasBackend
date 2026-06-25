-- 22_update_active_user_emails.sql
-- Actualiza correos de funcionarios activos según matriz validada.
-- Nota: si un correo ya está en uso por otro usuario, ese registro se omite para evitar violar la restricción UNIQUE.

WITH nuevos(nombre, email) AS (
    VALUES
    ('ABRIL CUERVO ANDREA PATRICIA', 'apabril@investinbogota.org'),
    ('AGUDELO VALENCIA JOHANA MARCELA', 'johjagudelo@investinbogota.org'),
    ('BARRAGAN JOSE NICOLAS', 'jbarragan@investinbogota.org'),
    ('CABRERA SILVA JENNY JASMIN', 'jcabrera@investinbogota.org'),
    ('CARDENAS PEREZ GABRIELA', 'gcardenas@investinbogota.org'),
    ('CARDENAS PINZON VALERIA', 'vcardenas@investinbogota.org'),
    ('CASELLES RINCÓN NADIA KAMILA', 'ncaselles@investinbogota.org'),
    ('CHACON PINEDA ALIX AYDA', 'gestionhumana@investinbogota.org'),
    ('DIAZ SANCHEZ DEISY', 'ddiaz@investinbogota.org'),
    ('DIAZ TORO FERNADO HUMBERTO', 'fdiaz@investinbogota.org'),
    ('ESPINOSA MENESES SAMUEL', 'sespinosa@investinbogota.org'),
    ('FAJARDO GOMEZ LUZ EDIT', 'lfajardo@investinbogota.org'),
    ('FIGUEROA RODRIGUEZ ANDREA CATALINA', 'afigueroa@investinbogota.org'),
    ('GARCIA ACEVEDO LINA MARCELA', 'lgarcia@investinbogota.org'),
    ('GARCIA DURAN DANIELA', 'dgarcia@investinbogota.org'),
    ('GIRALDO VASQUEZ JUAN SEBASTIAN', 'jgiraldo@investinbogota.org'),
    ('GOMEZ PELAEZ JULIANA', 'jgomezp@investinbogota.org'),
    ('GONZALEZ CASTRO ADRIANA MARCELA', 'agonzalez@investinbogota.org'),
    ('HERNANDEZ HERNANDEZ ANA EMILET', 'aehernandez@investinbogota.org'),
    ('INFANTE MARTINEZ MARIA JOSE', 'minfante@investinbogota.org'),
    ('MARTINEZ QUINTERO VALERIA', 'vmartinez@investinbogota.org'),
    ('MEJIA PLAZAS ALEJANDRA', 'amejia@investinbogota.org'),
    ('MONTAÑA CAMARGO CATALINA', 'cmontana@investinbogota.org'),
    ('MONTAÑA ORJUELA ANDREA', 'amontana@investinbogota.org'),
    ('MONTEREY ARANDA IVANOFF', 'imonterrey@investinbogota.org'),
    ('MORALES ARISTIZABAL LUIS FELIPE', 'lmorales@investinbogota.org'),
    ('OSPINA MOYA DANIELA', 'recepcion@investinbogota.org'),
    ('PEÑA TORRES KAREN JULIANA', 'jpena@investinbogota.org'),
    ('PINEDA VARGAS MICHAEL STEVE', 'mpineda@investinbogota.org'),
    ('PINZON JUAN FELIPE', 'jpinzon@investinbogota.org'),
    ('RINCON AMORTEGUI EDUAR', 'gestiondocumental@investinbogota.org'),
    ('ROJAS JOSE LUIS', 'jrojas@investinbogota.org'),
    ('SANCHEZ CARLOS', 'csanchez@investinbogota.org'),
    ('SANCHEZ CARDONA JULIETH MARCELA', 'mcardona@investinbogota.org'),
    ('SANDOVAL LINA PAOLA', 'lsandoval@investinbogota.org'),
    ('SOLANO OLARTE FRANSISCO', 'fsolano@investinbogota.org'),
    ('TAMAYO SANDRA CAROLINA', 'ctamayo@investinbogota.org'),
    ('TIBADUIZA LEON LUIS ALEJANDRO', 'ltibaduisa@investinbogota.org'),
    ('TOBON ARANGO LAURA', 'ltobon@investinbogota.org'),
    ('VANOY ESPITIA LUZ ALEYDA', 'lvanoy@investinbogota.org'),
    ('VASQUEZ VERGARA LUISA FERNANDA', 'lvasquez@investinbogota.org'),
    ('VERGARA GARCIA MARIA ALEJANDRA', 'mvergara@investinbogota.org')
)
UPDATE usuarios u
SET
    email = n.email,
    actualizado_en = NOW()
FROM nuevos n
WHERE u.nombre = n.nombre
  AND LOWER(u.email) <> LOWER(n.email)
  AND NOT EXISTS (
      SELECT 1
      FROM usuarios u_conflict
      WHERE LOWER(u_conflict.email) = LOWER(n.email)
        AND u_conflict.id <> u.id
  );
