import os from 'node:os';
import path from 'node:path';
import dotenv from 'dotenv';

// Production keeps secrets and mutable configuration outside the Git clone.
// A local .env remains supported for development and older installations.
const externalConfig = process.env.FACTURO_ENV_FILE || path.join(os.homedir(), '.config/facturo/facturo.env');
dotenv.config({ path: externalConfig });
dotenv.config();
