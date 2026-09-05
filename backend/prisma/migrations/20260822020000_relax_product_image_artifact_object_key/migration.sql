-- A source artifact is an immutable per-task audit record. The same managed
-- source file must be recordable again after a task fails or expires.
DROP INDEX IF EXISTS "ProductImageArtifact_objectKey_key";
