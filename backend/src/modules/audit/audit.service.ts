import type { Request } from "express";
import { prisma } from "../../lib/prisma.js";

type AuditInput = {
  userId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  req?: Request;
};

/**
 * Registra evento de auditoria. Nunca lança erro: auditoria não pode
 * derrubar a requição principal, mas falhas são registradas em console.
 */
export async function audit(input: AuditInput): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        userId: input.userId ?? null,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        metadata: input.metadata ? JSON.stringify(input.metadata) : null,
        ip: input.req?.ip,
        userAgent: input.req?.get("user-agent"),
      },
    });
  } catch (err) {
    console.error("[audit] falha ao registrar auditoria:", err);
  }
}
