import type { SOSMessage } from '../types/sos';

export interface ISyncService {
    syncMessage(message: SOSMessage): Promise<boolean>;
    onMessageReceived(callback: (message: SOSMessage) => void): void;
}

// Local-first P2P sync service. No external servers.
export class PluggableSyncService implements ISyncService {
    async syncMessage(message: SOSMessage): Promise<boolean> {
        console.log('[SyncService] P2P mesh handles sync locally:', message);
        return true;
    }

    onMessageReceived(_callback: (message: SOSMessage) => void): void {
        // P2P mesh handles incoming messages via WebRTC
    }
}

export const syncService = new PluggableSyncService();
