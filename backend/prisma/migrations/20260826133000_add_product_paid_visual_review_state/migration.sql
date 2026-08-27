-- Paid generative candidates require an explicit factual review before they
-- can become adoptable. This is distinct from provider/billing reconciliation.
ALTER TYPE "ProductImageOptimizationStatus" ADD VALUE IF NOT EXISTS 'PENDING_REVIEW';
