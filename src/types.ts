import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import type { payloadType } from './modules/auth/types';
import type { Storage } from './storage';

export type Variables = {
    db: LibSQLDatabase;
    // Disk on a self-hosted install, R2 on the hosted one. Routes never know which.
    storage: Storage;
    /** Set by a guard that PROVED the caller belongs to it. Never read the
     *  `orgId` header directly - that is caller-supplied, not caller-owned. */
    verifiedOrgId: number;
    jwtPayload: payloadType;
};
