# SmartAgency Backend

Backend FastAPI du système de gestion des agences et IoT.

## Installation locale

```powershell
cd C:\Users\Lenovo\Desktop\IOT\IOT\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Configurer ensuite `DATABASE_URL` dans `.env` :

```env
DATABASE_URL=postgresql+psycopg2://postgres:MOT_DE_PASSE@localhost:5432/agence_iot
```

Créer la base PostgreSQL `agence_iot`, puis appliquer les migrations :

```powershell
alembic upgrade head
uvicorn app.main:app --reload
```

API et documentation :

```text
http://127.0.0.1:8000/docs
```

Ne jamais versionner `.env`, les mots de passe, les tokens JWT ou le dossier `.venv`.

## Authentification

Inscription publique — crée un compte `AGENT` :

```text
POST /api/auth/register
```

Connexion :

```text
POST /api/auth/login
```

Après connexion, copier `access_token` et cliquer sur **Authorize** dans Swagger.
Selon l'interface Swagger, coller le token seul ou sous la forme `Bearer <token>`.

Profil connecté :

```text
GET /api/auth/me
```

## Agences

```text
GET    /api/agencies
POST   /api/agencies
GET    /api/agencies/{agency_id}
PUT    /api/agencies/{agency_id}
DELETE /api/agencies/{agency_id}
```

Un ADMIN peut gérer toutes les agences. Un MANAGER peut gérer uniquement son agence.
Une agence contient des zones, des guichets, des employés, des appareils et des caméras.

## Employés

```text
GET    /api/employees
POST   /api/employees
GET    /api/employees/{employee_id}
PUT    /api/employees/{employee_id}
DELETE /api/employees/{employee_id}
```

Exemple :

```json
{
  "first_name": "Ahmed",
  "last_name": "Benali",
  "email": "ahmed.benali@agence.com",
  "phone": "0612345678",
  "position": "Agent d'accueil",
  "agency_id": "ID_AGENCE",
  "rfid_uid": "RFID-001",
  "status": "ACTIVE",
  "hire_date": "2026-08-01"
}
```

## Utilisateurs, rôles et permissions

La gestion des utilisateurs est réservée à `ADMIN` :

```text
GET    /api/users
POST   /api/users
GET    /api/users/{user_id}
PUT    /api/users/{user_id}
PATCH  /api/users/{user_id}/role
PATCH  /api/users/{user_id}/agency
PATCH  /api/users/{user_id}/access
DELETE /api/users/{user_id}
```

Pour modifier simultanément le rôle et l'agence d'un utilisateur, utilisez :

```text
PATCH /api/users/{user_id}/access
```

```json
{
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID"
}
```

Le rôle et l'agence sont validés sur leur état final dans une seule transaction.

Rôles disponibles :

```text
ADMIN       Accès complet et gestion des utilisateurs
MANAGER     Gestion de son agence et de ses employés
AGENT       Gestion des visiteurs et des tickets
SECURITY    Présences, caméras, alertes et incidents
TECHNICIAN  Appareils IoT, capteurs, MQTT et maintenance
```

Un compte peut être relié à un employé avec `employee_id` :

```json
{
  "full_name": "Sara Security",
  "email": "sara@agence.com",
  "password": "Security12345",
  "role": "SECURITY",
  "agency_id": "ID_AGENCE",
  "employee_id": "ID_EMPLOYE"
}
```

La relation est optionnelle et unique : un employé ne peut être lié qu'à un seul compte.

## Visiteurs et tickets

Visiteurs :

```text
POST /api/visitors
GET  /api/visitors
GET  /api/visitors/{visitor_id}
```

Tickets :

```text
POST /api/tickets
GET  /api/tickets/queue
POST /api/tickets/{ticket_id}/call
POST /api/tickets/{ticket_id}/complete
POST /api/tickets/{ticket_id}/cancel
```

États possibles : `WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `CANCELLED`.
Un ticket est créé pour un visiteur, reçoit un numéro quotidien, puis est appelé
par un guichet de la même agence.

## Présence RFID

```text
POST /api/attendance/check-in
POST /api/attendance/check-out
GET  /api/attendance/today
GET  /api/attendance/employee/{employee_id}
```

Message MQTT attendu :

```text
agency/{agency_id}/device/{device_id}/attendance
```

```json
{
  "employee_rfid": "RFID-001",
  "event": "check_in",
  "timestamp": "2026-08-01T12:00:00Z"
}
```

Les mises à jour sont diffusées par :

```text
ws://127.0.0.1:8000/ws/attendance?token=ACCESS_TOKEN
```

## Structure principale

```text
app/
├── api/             Routes REST
├── core/            Configuration et sécurité
├── database/        Connexion et migrations Alembic
├── models/          Modèles SQLAlchemy
├── mqtt/            Consommateurs MQTT
├── schemas/         Schémas Pydantic
├── services/        Logique métier
└── websocket/       Notifications temps réel
```

Pour les détails du matériel, du câblage ESP32/RC522, des scénarios IoT et des règles
fonctionnelles, consulter la documentation disponible dans Discord.
