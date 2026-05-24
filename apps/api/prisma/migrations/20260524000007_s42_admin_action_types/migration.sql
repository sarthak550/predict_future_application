-- S42-T13(b): Add semantically correct enum values for analyst tier admin actions.
-- Previously, verify-analyst route was incorrectly using ADJUST_BALANCE.
ALTER TYPE "AdminActionType" ADD VALUE 'GRANT_VERIFIED_ANALYST';
ALTER TYPE "AdminActionType" ADD VALUE 'REVOKE_VERIFIED_ANALYST';
