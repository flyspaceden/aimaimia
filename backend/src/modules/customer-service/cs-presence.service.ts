import { Injectable } from '@nestjs/common';

@Injectable()
export class CsPresenceService {
  private readonly socketSessions = new Map<string, { sessionId: string; userId: string }>();
  private readonly userSessionSockets = new Map<string, Set<string>>();

  markUserInSession(sessionId: string, userId: string, socketId: string): void {
    if (!sessionId || !userId || !socketId) return;

    this.markSocketDisconnected(socketId);
    const key = this.key(sessionId, userId);
    const sockets = this.userSessionSockets.get(key) ?? new Set<string>();
    sockets.add(socketId);
    this.userSessionSockets.set(key, sockets);
    this.socketSessions.set(socketId, { sessionId, userId });
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
    const sockets = this.userSessionSockets.get(this.key(sessionId, userId));
    return Boolean(sockets && sockets.size > 0);
  }

  private key(sessionId: string, userId: string): string {
    return `${sessionId}:${userId}`;
  }
}
