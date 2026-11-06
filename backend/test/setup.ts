import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.test' });

import { types } from 'pg';
types.setTypeParser(1082, (val: string) => val); // DATE → plain 'YYYY-MM-DD' string
