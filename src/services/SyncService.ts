import type { SOSMessage } from '../types/sos';

export interface ISyncService {
    syncMessage(message: SOSMessage): Promise<boolean>;
    onMessageReceived(callback: (message: SOSMessage) => void): void;
}

// Initial placeholder implementation. Can be replaced with Firebase or Next.js API.
export class PluggableSyncService implements ISyncService {
    async syncMessage(message: SOSMessage): Promise<boolean> {
        console.log('[SyncService] Mock syncing message:', message);
        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 1000));
        return true;
    }

    onMessageReceived(_callback: (message: SOSMessage) => void): void {
        // Mock incoming messages from server
    }
}

export const syncService = new PluggableSyncService();
