import { z } from 'zod';

// Enum values matching the database schema
export const reviewStatusValues = ['pending', 'approved', 'rejected', 'changes_requested'] as const;
export const reviewActionValues = ['approved', 'rejected', 'changes_requested'] as const;
export const reviewModeValues = ['auto', 'always-required', 'always-skip'] as const;

// Create Review Schema
export const createReviewSchema = z
    .object({
        status: z.enum(reviewActionValues, {
            required_error: 'Status is required',
            invalid_type_error: 'Status must be one of: approved, rejected, changes_requested',
        }),
        message: z
            .string({
                invalid_type_error: 'Message must be a string',
            })
            .min(1, 'Message cannot be empty')
            .max(2000, 'Message cannot exceed 2000 characters')
            .optional(),
        notifyAnnotator: z
            .boolean({
                invalid_type_error: 'notifyAnnotator must be a boolean',
            })
            .default(true),
    })
    .refine(
        (data) => {
            // Message is required if status is 'rejected' or 'changes_requested'
            if (data.status === 'rejected' || data.status === 'changes_requested') {
                //mesajı isteğe bağlı olarak da duzenleyebiliriz fakat şuan gerekli olarak bırakıyorum
                return data.message !== undefined && data.message.trim().length > 0;
            }
            return true;
        },
        {
            message: 'Message is required when rejecting or requesting changes',
            path: ['message'],
        }
    );

// Update Review Schema
export const updateReviewSchema = z
    .object({
        status: z
            .enum(reviewActionValues, {
                invalid_type_error: 'Status must be one of: approved, rejected, changes_requested',
            })
            .optional(),
        message: z
            .string({
                invalid_type_error: 'Message must be a string',
            })
            .min(1, 'Message cannot be empty')
            .max(2000, 'Message cannot exceed 2000 characters')
            .optional(),
    })
    .refine(
        //mesajı opsiyonel yaparsak burası da değişecek
        (data) => {
            // If status is being updated to rejected or changes_requested, message should be provided
            if (
                (data.status === 'rejected' || data.status === 'changes_requested') &&
                (data.message === undefined || data.message.trim().length === 0)
            ) {
                return false;
            }
            return true;
        },
        {
            message: 'Message is required when rejecting or requesting changes',
            path: ['message'],
        }
    );

// Project Review Settings Schema
export const projectReviewSettingsSchema = z.object({
    reviewMode: z
        .enum(reviewModeValues, {
            invalid_type_error: 'reviewMode must be one of: auto, always-required, always-skip',
        })
        .optional(),
    allowSelfReview: z
        .boolean({
            invalid_type_error: 'allowSelfReview must be a boolean',
        })
        .optional(),
    autoAssignReviewer: z
        .boolean({
            invalid_type_error: 'autoAssignReviewer must be a boolean',
        })
        .optional(),
});

// Review Query Schema (for filtering/pagination)
export const reviewQuerySchema = z.object({
    status: z
        .enum(reviewStatusValues, {
            invalid_type_error: 'status must be one of: pending, approved, rejected, changes_requested',
        })
        .optional(),
    reviewerId: z
        .string({
            invalid_type_error: 'reviewerId must be a string',
        })
        .optional(),
    annotationId: z
        .string({
            invalid_type_error: 'annotationId must be a string',
        })
        .optional(),
    taskId: z
        .string({
            invalid_type_error: 'taskId must be a string',
        })
        .optional(),
    page: z
        .number({
            invalid_type_error: 'page must be a number',
        })
        .int('page must be an integer')
        .min(1, 'page must be at least 1')
        .default(1),
    limit: z
        .number({
            invalid_type_error: 'limit must be a number',
        })
        .int('limit must be an integer')
        .min(1, 'limit must be at least 1')
        .max(100, 'limit cannot exceed 100')
        .default(20),
});

// Type exports inferred from schemas
export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type UpdateReviewInput = z.infer<typeof updateReviewSchema>;
export type ProjectReviewSettingsInput = z.infer<typeof projectReviewSettingsSchema>;
export type ReviewQueryInput = z.infer<typeof reviewQuerySchema>;

// Export enum types
export type ReviewStatus = (typeof reviewStatusValues)[number];
export type ReviewAction = (typeof reviewActionValues)[number];
export type ReviewMode = (typeof reviewModeValues)[number];
