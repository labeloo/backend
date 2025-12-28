-- Migration 0003: Review system improvements
-- 1. Add partial unique index to prevent race condition on pending reviews
-- 2. Rename reviewerId to assignedReviewerId for clarity

-- FIX #2: Partial unique index - only one pending review per annotation allowed
-- This prevents race conditions where two reviewers could create pending reviews simultaneously
CREATE UNIQUE INDEX IF NOT EXISTS idx_reviews_annotation_pending 
ON reviews (annotation_id) 
WHERE status = 'pending';

-- FIX #3: Rename column for semantic clarity
-- reviewerId was ambiguous: could mean "assigned reviewer" or "last reviewer"
-- Now: assignedReviewerId = who is assigned to review (stable, set by workflow)
-- The actual reviewer who performed the review is stored in reviews.reviewer_id
ALTER TABLE annotations RENAME COLUMN reviewer_id TO assigned_reviewer_id;
