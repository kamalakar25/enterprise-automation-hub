import prisma from '../config/db.js';

/**
 * Creates an audit log entry. Called by route handlers after performing actions.
 */
export async function audit({ req, action, resourceType, resourceId, metadata }) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: req.user?.id || null,
        action,
        resourceType,
        resourceId,
        metadata: metadata || null,
        ipAddress: req.ip,
      },
    });
  } catch (err) {
    // audit failure should never break the request
    console.error('Audit log error:', err.message);
  }
}
