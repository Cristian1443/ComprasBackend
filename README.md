# Portal Compras y Contratación — Backend

API REST con Express.js y PostgreSQL para el portal de compras y contratación de **Invest in Bogotá**.

## Stack

| Tecnología | Versión |
|---|---|
| Node.js | ≥ 18 |
| Express | 4 |
| PostgreSQL | 14+ |
| node-postgres (pg) | 8 |
| Azure MSAL Node | 5 |
| Multer | 2 |
| Nodemailer | 8 |
| PDFKit | 0.18 |

## Requisitos previos

- Node.js ≥ 18
- PostgreSQL 14+ corriendo localmente (o accesible en red)
- Base de datos `compras_db` creada

## Inicio rápido

```bash
# 1. Instalar dependencias
npm install

# 2. Configurar variables de entorno
cp .env.example .env
# → Editar .env con los valores reales (DB, SMTP, Adobe Sign, etc.)

# 3. Ejecutar migraciones de base de datos (primera vez)
npm run db:migrate

# 4. Iniciar servidor de desarrollo
npm run dev
# → API disponible en http://localhost:3001
```

## Scripts disponibles

| Comando | Descripción |
|---|---|
| `npm start` | Servidor de producción |
| `npm run dev` | Servidor con hot-reload (`--watch`) |
| `npm run db:migrate` | Ejecutar migraciones SQL |
| `npm run db:seed` | Cargar datos iniciales de usuarios |
| `npm run db:check` | Verificar esquema de la base de datos |

## Estructura

```
├── server.js            # Entrada principal – Express app, rutas y middleware
├── routes/
│   └── firmas.js        # Endpoints de firma digital (Adobe Acrobat Sign)
├── services/
│   ├── adobeSign.js     # Wrapper de la API de Adobe Sign
│   └── pdfGenerator.js  # Generación de documentos PDF
├── database/
│   └── migrations/      # Scripts SQL numerados (00_install → 40_*)
├── uploads/             # Archivos subidos (gitignoreado)
│   ├── convocatorias/
│   ├── solicitudes/
│   ├── juridica/
│   ├── facturas/
│   ├── firmas/
│   └── actas/
└── scripts/             # Utilerías de desarrollo y mantenimiento DB
```

## Endpoints principales

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/auth/sync` | Sincronizar usuario Azure AD |
| GET | `/api/usuarios/me` | Perfil del usuario autenticado |
| GET/POST | `/api/solicitudes` | Listar / crear solicitudes |
| PATCH | `/api/solicitudes/:id/estado` | Cambiar estado de solicitud |
| POST | `/api/solicitudes/:id/aprobar-gerente` | Aprobación de gerente |
| POST | `/api/solicitudes/:id/aprobar-financiera` | Aprobación financiera |
| GET | `/api/supervisor/contratos` | Contratos asignados al supervisor |
| POST | `/api/supervisor/evaluacion` | Registrar evaluación de proveedor |
| GET | `/api/gerencias` | Catálogo de gerencias |
| GET | `/api/rubros` | Catálogo de rubros presupuestales |
| GET | `/api/uploads/*` | Archivos estáticos subidos |

## Variables de entorno

| Variable | Requerida | Descripción |
|---|---|---|
| `API_PORT` | No | Puerto del servidor (default: 3001) |
| `API_PUBLIC_URL` | Sí (OAuth) | URL pública del backend |
| `FRONTEND_URL` | Sí | URL del frontend (CORS y emails) |
| `DB_HOST` | Sí | Host de PostgreSQL |
| `DB_PORT` | No | Puerto PostgreSQL (default: 5432) |
| `DB_NAME` | Sí | Nombre de la base de datos |
| `DB_USER` | Sí | Usuario de PostgreSQL |
| `DB_PASSWORD` | Sí | Contraseña de PostgreSQL |
| `RATE_LIMIT_RPM` | No | Límite de peticiones/min (default: 60) |
| `SMTP_HOST` | No | Host SMTP para correos |
| `SMTP_PORT` | No | Puerto SMTP (default: 587) |
| `SMTP_SECURE` | No | TLS directo (`true`/`false`) |
| `SMTP_USER` | No | Usuario SMTP |
| `SMTP_PASS` | No | Contraseña SMTP |
| `ADOBE_CLIENT_ID` | Sí (firmas) | Client ID de Adobe Acrobat Sign |
| `ADOBE_CLIENT_SECRET` | Sí (firmas) | Secret de Adobe Acrobat Sign |
| `ADOBE_REDIRECT_URI` | Sí (firmas) | URI de callback OAuth Adobe Sign |
| `ADOBE_SIGN_BASE_URL` | Sí (firmas) | URL base API Adobe Sign |

## Base de datos

Las migraciones están numeradas secuencialmente en `database/migrations/`. Para aplicarlas en orden:

```bash
# Aplicar todas las migraciones en orden
npm run db:migrate

# O manualmente con psql
psql -U postgres -d compras_db -f database/migrations/00_install.sql
psql -U postgres -d compras_db -f database/migrations/01_schema.sql
# ...
```

## CORS

Por defecto acepta peticiones de `localhost:3000` y `localhost:5173` (Vite). En producción, ajustar `FRONTEND_URL` en `.env`.
