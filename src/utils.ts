import path from 'path';

/**
 * Resolve a path inside `root`, refusing anything that escapes it.
 *
 * The bucket routes build file paths straight from URL parameters. Hono decodes
 * percent-escapes before the handler sees them, so a `fileName` of `..%2f..%2f..%2f..%2fetc%2fpasswd`
 * arrives as a real traversal sequence - which read any file on the host,
 * unauthenticated, including the SQLite database with every password hash.
 *
 * Returns null when the request tries to leave the root.
 */
export const resolveInsideRoot = (root: string, ...segments: string[]): string | null => {
    const absoluteRoot = path.resolve(root);
    const candidate = path.resolve(absoluteRoot, ...segments);
    // path.resolve normalises `..`, so a candidate that still starts with the root
    // (plus a separator, to reject sibling directories like `/app/bucket-evil`)
    // is genuinely contained.
    if (candidate !== absoluteRoot && !candidate.startsWith(absoluteRoot + path.sep)) {
        return null;
    }
    return candidate;
};

import type { LibSQLDatabase } from 'drizzle-orm/libsql/driver-core';
import {
    organizationRelations,
    organizationRoles,
    projectRoles,
    projectRelations,
} from './db/schema';
import { and, eq } from 'drizzle-orm';

export const checkOrganizationPermission = async (
    db: LibSQLDatabase,
    userId: number,
    organizationId: number,
    flag: keyof typeof organizationRoles.$inferSelect.permissionFlags
) => {
 /*    const permissions = await db
        .select({ permissionFlags: organizationRoles.permissionFlags })
        .from(organizationRoles)
        .fullJoin(
            organizationRelations,
            eq(organizationRoles.id, organizationRelations.roleId)
        )
        .where(
            and(
                eq(organizationRelations.userId, userId),
                eq(organizationRelations.organizationId, organizationId)
            )
        )
        .get(); */

        // console.log('Checking organization permissions for user:', userId, 'in organization:', organizationId, 'for flag:', flag);
    const permissions = await db
        .select({ permissionFlags: organizationRoles.permissionFlags })
        .from(organizationRelations)
        .where(
            and(
                eq(organizationRelations.userId, userId),
                eq(organizationRelations.organizationId, organizationId)
            )
        )
        .innerJoin(
            organizationRoles,
            eq(organizationRoles.id, organizationRelations.roleId)
        )
        .get();
console.log('Permissions found:', permissions);

    if (!permissions)
        throw new Error('User has no permissions for this organization');
    // @ts-ignore
    if (permissions?.permissionFlags.admin) return true;
    // @ts-ignore
    const hasPermission = permissions.permissionFlags[flag] ?? false;
    if (!hasPermission)
        throw new Error(`User does not have permission: ${flag}`);

    return true;
};

export const checkProjectPermission = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number,
    flag: keyof typeof projectRoles.$inferSelect.permissionFlags
) => {
    const permissions = await db
        .select({ permissionFlags: projectRoles.permissionFlags })
        .from(projectRoles)
        .innerJoin(
            projectRelations,
            eq(projectRoles.id, projectRelations.roleId)
        )
        .where(
            and(
                eq(projectRelations.userId, userId),
                eq(projectRelations.projectId, projectId)
            )
        )
        .get();

    if (!permissions)
        throw new Error('User has no permissions for this project');
    
    const hasPermission = permissions.permissionFlags[flag] ?? false;
    if (!hasPermission)
        throw new Error(`User does not have permission: ${flag}`);

    return true;
};

