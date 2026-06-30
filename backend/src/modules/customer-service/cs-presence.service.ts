import { Injectable } from '@nestjs/common';

@Injectable()
export class CsPresenceService {
  private static readonly HTTP_ACTIVE_TTL_MS = 15_000;

  private readonly socketSessions = new Map<string, { sessionId: string; userId: string }>();
  private readonly userSessionSockets = new Map<string, Set<string>>();
  private readonly userSessionActiveUntil = new Map<string, number>();

  markUserInSession(sessionId: string, userId: string, socketId: string): void {
    if (!sessionId || !userId || !socketId) return;

    this.markSocketDisconnected(socketId);
    const key = this.key(sessionId, userId);
    const sockets = this.userSessionSockets.get(key) ?? new Set<string>();
    sockets.add(socketId);
    this.userSessionSockets.set(key, sockets);
    this.socketSessions.set(socketId, { sessionId, userId });
  }

  markUserActiveInSession(sessionId: string, userId: string): void {
    if (!sessionId || !userId) return;
    this.userSessionActiveUntil.set(
      this.key(sessionId, userId),
      Date.now() + CsPresenceService.HTTP_ACTIVE_TTL_MS,
    );
  }

  markSocketDisconnected(socketId: string): void {
    if (!socketId) return;

    const existing = this.socketSessions.get(socketId);
    if (!existing) return;

    const key = this.key(existing.sessionId, existing.userId);
    const sockets = this.userSessionSockets.get(key);
    if (sockets) {
      sockets.delete(socketId);
      if (sockets.size === 0) {
        this.userSessionSockets.delete(key);
      }
    }
    this.socketSessions.delete(socketId);
  }

  isUserInSession(sessionId: string, userId: string): boolean {
    const key = this.key(sessionId, userId);
    const sockets = this.userSessionSockets.get(key);
    if (sockets && sockets.size > 0) return true;

    const activeUntil = this.userSessionActiveUntil.get(key);
    if (!activeUntil) return false;
    if (activeUntil <= Date.now()) {
      this.userSessionActiveUntil.delete(key);
      return false;
    }
    return true;
  }

  private key(sessionId: string, userId: string): string {
    return `${sessionId}:${userId}`;
  }
}
