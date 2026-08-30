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

GET    /api/agencies/{agency_id}/services
POST   /api/agencies/{agency_id}/services
GET    /api/services/{service_id}
PUT    /api/services/{service_id}
DELETE /api/services/{service_id}
GET    /api/services/{service_id}/points
PATCH  /api/counters/{counter_id}/service

GET    /api/devices
POST   /api/devices/agencies/{agency_id}
GET    /api/devices/{device_id}
PUT    /api/devices/{device_id}
POST   /api/devices/{device_id}/rotate-key
DELETE /api/devices/{device_id}
```

Un ADMIN peut gérer toutes les agences. Un MANAGER peut gérer uniquement son agence.
Une agence contient des zones, des guichets, des employés, des appareils et des caméras.

## Caméras et alertes IA d'armes

Routes de gestion des caméras :

```text
GET    /api/agencies/{agency_id}/cameras
POST   /api/agencies/{agency_id}/cameras
PUT    /api/cameras/{camera_id}
DELETE /api/cameras/{camera_id}
```

Créer chaque caméra avec un nom unique qui correspond exactement au nom de la
source déclarée dans le service IA :

```json
{
  "name": "cam1",
  "stream_url": "rtsp://192.168.1.16:8554/stream"
}
```

Le backend synchronise automatiquement les caméras avec
`POST /weapon/sources` du service IA et consomme
`WS /weapon/alerts/stream`. Une détection reçue au-dessus du seuil est
enregistrée dans `alerts` avec `camera_id`, `agency_id`, le niveau `CRITICAL`
et le statut `OPEN`. Une mise à jour sans détection clôture l'alerte ouverte.

Le service IA doit être lancé sur un port différent de l'API backend, par
exemple :

```powershell
uvicorn ai.main:app --host 127.0.0.1 --port 8001
```

Configuration backend correspondante dans `.env` :

```env
AI_SERVICE_URL=http://127.0.0.1:8001
AI_ALERTS_ENABLED=true
```

Seuil métier global pour les armes :

```text
GET /api/ai-alerts/thresholds/weapon
PUT /api/ai-alerts/thresholds/weapon
```

Exemple :

```json
{
  "confidence": 0.60
}
```

Le seuil accepte une valeur strictement supérieure à `0` et inférieure ou
égale à `1`. Il est conservé dans PostgreSQL et appliqué immédiatement. Il
est distinct du `conf` interne du modèle IA.

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

Pour changer simultanément le rôle et l'agence, utiliser la route atomique :

```text
PATCH /api/users/{user_id}/access
```

```json
{
  "role": "SECURITY",
  "agency_id": "AGENCY_UUID"
}
```

Le serveur valide l'état final du couple rôle/agence dans une seule transaction.

## Visiteurs et tickets

### Appareils IoT

Un appareil doit être enregistré par un `ADMIN`, `MANAGER` ou `TECHNICIAN` avant
d'envoyer des données. La clé `device_key` est affichée une seule fois lors de
l'enregistrement et doit être conservée par Basma dans l'ESP32.

```http
POST /api/devices/agencies/{agency_id}
```

```json
{
  "name": "Borne tickets accueil",
  "device_type": "TICKET_KIOSK",
  "mqtt_client_id": "ticket-kiosk-01",
  "mqtt_topic": "agency/AGENCY_UUID/device/ticket-kiosk-01/sensor"
}
```

La réponse contient `device_key`. Cette clé ne doit jamais être committée dans
Git ni envoyée dans Discord. Pour la remplacer, utiliser
`POST /api/devices/{device_id}/rotate-key`.

### Endpoints internes hardware

Les deux endpoints internes exigent l'en-tête :

```http
X-Device-Key: DEVICE_KEY
```

Le `device_id` du contrat hardware correspond au `mqtt_client_id` enregistré
dans `devices`, et non à l'UUID interne de la table.

```http
POST /internal/tickets/walk-in
```

```json
{
  "agency_id": "AGENCY_UUID",
  "device_id": "ticket-kiosk-01",
  "service_id": "SERVICE_UUID",
  "visitor": {
    "full_name": "Visiteur borne",
    "phone": null,
    "identity_reference": null
  },
  "timestamp": "2026-08-25T14:32:00Z"
}
```

Réponse :

```json
{
  "ticket_id": "TICKET_UUID",
  "ticket_number": "20260825-OPERATIONS-001",
  "service_id": "SERVICE_UUID",
  "service_type": "Opérations courantes",
  "status": "WAITING"
}
```

Pour compatibilité temporaire, `service_type` peut remplacer `service_id` si
sa valeur correspond exactement au `code` ou au nom du service. Basma doit
privilégier `service_id`.

```http
POST /internal/attendance/check-rfid
```

```json
{
  "agency_id": "AGENCY_UUID",
  "device_id": "rfid-gate-01",
  "employee_rfid": "A1B2C3D4",
  "event": "check_in",
  "timestamp": "2026-08-25T09:15:00Z"
}
```

Réponse valide :

```json
{
  "valid": true,
  "employee_name": "Ahmed Benali",
  "event": "check_in",
  "message": null
}
```

Réponse pour carte inconnue ou opération impossible :

```json
{
  "valid": false,
  "employee_name": null,
  "event": null,
  "message": "Carte RFID ou employe introuvable"
}
```

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

La création d'un ticket nécessite désormais le service de l'agence :

```json
{
  "visitor_id": "VISITOR_UUID",
  "service_id": "SERVICE_UUID"
}
```

La file peut être filtrée par service avec `GET /api/tickets/queue?service_id=SERVICE_UUID`.
Un ticket ne peut être appelé que par un guichet ou un bureau affecté au même service.

Affectation d'un guichet ou d'un bureau :

```text
PATCH /api/counters/{counter_id}/service
```

```json
{
  "service_id": "SERVICE_UUID"
}
```

Le type du point (`COUNTER` ou `OFFICE`) est automatiquement aligné sur le service.

États possibles : `WAITING`, `CALLED`, `IN_SERVICE`, `COMPLETED`, `CANCELLED`.
Un ticket est créé pour un visiteur, reçoit un numéro quotidien, puis est appelé
par un guichet de la même agence.

## MQTT DHT22 et MQ-7

Le backend écoute le sujet :

```text
agency/{agency_id}/device/{device_id}/sensor
```

Message DHT22 :

```json
{
  "readings": [
    { "sensor_type": "temperature", "value": 24.5, "unit": "C" },
    { "sensor_type": "humidity", "value": 61.2, "unit": "%" }
  ],
  "timestamp": "2026-08-25T10:00:00Z"
}
```

Message MQ-7 :

```json
{
  "readings": [
    { "sensor_type": "gas_co", "value": 12.4, "unit": "ppm" }
  ],
  "timestamp": "2026-08-25T10:00:05Z"
}
```

Chaque mesure est enregistrée dans `sensor_readings`. L'appareil doit déjà
être présent dans `devices` avec le même `mqtt_client_id` que celui du sujet.

### Configuration des seuils

```text
GET /api/devices/{device_id}/thresholds
PUT /api/devices/{device_id}/thresholds/{sensor_type}
DELETE /api/devices/{device_id}/thresholds/{sensor_type}
```

Exemple pour la température :

```json
{
  "unit": "C",
  "warning_max": 30,
  "critical_max": 40,
  "is_active": true
}
```

Une valeur supérieure ou égale à `warning_max` crée une alerte `HIGH`. Une
valeur supérieure ou égale à `critical_max` crée une alerte `CRITICAL`.

### Commandes backend vers hardware

Lorsqu'un seuil est dépassé, le backend publie :

```text
agency/{agency_id}/device/{device_id}/alert
```

```json
{
  "alert_type": "gas_co",
  "active": true,
  "severity": "CRITICAL"
}
```

Quand la valeur revient à la normale, `active` devient `false`.

Pour le capteur `temperature`, le backend publie également l'état du
climatiseur/stepper :

```text
agency/{agency_id}/device/{device_id}/climate
```

```json
{
  "active": true
}
```

La commande `climate` suit le seuil `warning_max` de la température et est
réémise à chaque mesure afin de restaurer l'état après un redémarrage.

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
