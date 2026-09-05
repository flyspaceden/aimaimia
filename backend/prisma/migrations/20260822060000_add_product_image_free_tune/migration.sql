-- P1b deterministic, zero-model visual enhancement. This migration is not
-- applied by local implementation work; deployment remains separately gated.
ALTER TYPE "ProductImageOptimizationKind" ADD VALUE IF NOT EXISTS 'FREE_TUNE';
ALTER TYPE "ProductMediaVisualOrigin" ADD VALUE IF NOT EXISTS 'DETERMINISTIC_ENHANCEMENT';
