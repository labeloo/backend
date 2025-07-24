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

