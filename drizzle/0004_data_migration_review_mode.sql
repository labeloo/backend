-- Migration 0004: Data migration for existing projects
-- Sets review_mode based on member count:
--   - 1 member: 'always-skip' (no one else to review)
--   - 2+ members: 'auto' (let system decide based on available reviewers)

-- Update projects with only 1 member to 'always-skip'
UPDATE projects
SET review_mode = 'always-skip',
    updatedAt = unixepoch()
WHERE id IN (
    SELECT project_id
    FROM project_relations
    GROUP BY project_id
    HAVING COUNT(DISTINCT user_id) = 1
);

-- Update projects with 2+ members to 'auto' (this is already the default, but explicit is better)
UPDATE projects
SET review_mode = 'auto',
    updatedAt = unixepoch()
WHERE id IN (
    SELECT project_id
    FROM project_relations
    GROUP BY project_id
    HAVING COUNT(DISTINCT user_id) >= 2
);

-- Verify: Log the results (these are just comments for documentation)
-- SELECT p.id, p.name, p.review_mode, COUNT(pr.user_id) as member_count
-- FROM projects p
-- LEFT JOIN project_relations pr ON p.id = pr.project_id
-- GROUP BY p.id;
