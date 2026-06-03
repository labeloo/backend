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

/** True if the user has any relation (membership) to the organization. */
export const isOrganizationMember = async (
    db: LibSQLDatabase,
    userId: number,
    organizationId: number
) => {
    const rel = await db
        .select({ id: organizationRelations.id })
        .from(organizationRelations)
        .where(
            and(
                eq(organizationRelations.userId, userId),
                eq(organizationRelations.organizationId, organizationId)
            )
        )
        .get();
    return !!rel;
};

/** Throws unless the user is a member of the organization. */
export const assertOrganizationMember = async (
    db: LibSQLDatabase,
    userId: number,
    organizationId: number
) => {
    if (!(await isOrganizationMember(db, userId, organizationId)))
        throw new Error('User is not a member of this organization');
    return true;
};

/** True if the user has any relation (membership) to the project. */
export const isProjectMember = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
) => {
    const rel = await db
        .select({ id: projectRelations.id })
        .from(projectRelations)
        .where(
            and(
                eq(projectRelations.userId, userId),
                eq(projectRelations.projectId, projectId)
            )
        )
        .get();
    return !!rel;
};

/** Throws unless the user is a member of the project. */
export const assertProjectMember = async (
    db: LibSQLDatabase,
    userId: number,
    projectId: number
) => {
    if (!(await isProjectMember(db, userId, projectId)))
        throw new Error('User is not a member of this project');
    return true;
};
