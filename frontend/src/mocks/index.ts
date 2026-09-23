/**
 * Loads every fixture file for its `registerMock()` side effect.
 *
 * Imported once from src/main.tsx. One import per endpoint group; the files
 * themselves call registerMock at module scope.
 */
import './fixtures/agencies'
import './fixtures/employees'
import './fixtures/users'
import './fixtures/tickets'
import './fixtures/services'
import './fixtures/assignments'
import './fixtures/devices'
import './fixtures/thresholds'
import './fixtures/cameras'
import './fixtures/zones'
import './fixtures/workstations'
import './fixtures/calibration'
import './fixtures/attendance'
import './fixtures/auth'

export {}
