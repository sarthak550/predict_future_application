-- AlterEnum: add OPINION_RESOLVED to NotificationType (S33-T1)
ALTER TYPE "NotificationType" ADD VALUE IF NOT EXISTS 'OPINION_RESOLVED';
