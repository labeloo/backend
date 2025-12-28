/**
 * Data Migration: Set review_mode for existing projects based on member count
 * 
 * Run this script after applying the SQL migrations if you need to:
 * - Re-run the data migration
 * - Have more control over the migration process
 * - Log detailed results
 * 
 * Usage: npx tsx scripts/migrate-review-mode.ts
 */

import { createClient } from '@libsql/client';
import { drizzle } from 'drizzle-orm/libsql';
import { eq, sql } from 'drizzle-orm';
import { projects, projectRelations } from '../src/db/schema';

async function migrateReviewMode() {
    // Initialize database connection
    const client = createClient({
        url: process.env.DATABASE_URL || 'file:./database.db',
    });
    const db = drizzle(client);

    console.log('Starting review_mode data migration...\n');

    try {
        // Get all projects with their member counts
        const projectsWithCounts = await db
            .select({
                projectId: projectRelations.projectId,
                memberCount: sql<number>`COUNT(DISTINCT ${projectRelations.userId})`.as('member_count'),
            })
            .from(projectRelations)
            .groupBy(projectRelations.projectId)
            .all();

        console.log(`Found ${projectsWithCounts.length} projects to process\n`);

        let singleMemberCount = 0;
        let multiMemberCount = 0;

        for (const { projectId, memberCount } of projectsWithCounts) {
            const newMode = memberCount === 1 ? 'always-skip' : 'auto';

            await db
                .update(projects)
                .set({
                    reviewMode: newMode,
                    updatedAt: Math.floor(Date.now() / 1000),
                })
                .where(eq(projects.id, projectId));

            if (memberCount === 1) {
                singleMemberCount++;
                console.log(`  Project ${projectId}: ${memberCount} member -> review_mode = 'always-skip'`);
            } else {
                multiMemberCount++;
                console.log(`  Project ${projectId}: ${memberCount} members -> review_mode = 'auto'`);
            }
        }

        console.log('\n--- Migration Summary ---');
        console.log(`Total projects processed: ${projectsWithCounts.length}`);
        console.log(`Single-member projects (always-skip): ${singleMemberCount}`);
        console.log(`Multi-member projects (auto): ${multiMemberCount}`);
        console.log('\nMigration completed successfully!');

    } catch (error) {
        console.error('Migration failed:', error);
        process.exit(1);
    } finally {
        client.close();
    }
}

migrateReviewMode();
