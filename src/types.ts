import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import type { payloadType } from './modules/auth/types';

export type Variables = {
    db: LibSQLDatabase;
    jwtPayload: payloadType;
};
