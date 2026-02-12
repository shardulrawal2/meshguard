import { openDB } from 'idb';
import type { IDBPDatabase } from 'idb';
import type { SOSMessage } from '../types/sos';

const DB_NAME = 'meshguard-db';
const DB_VERSION = 1;

export class OfflineStorage {
    private db: Promise<IDBPDatabase>;

    constructor() {
        this.db = openDB(DB_NAME, DB_VERSION, {
            upgrade(db) {
                if (!db.objectStoreNames.contains('messages')) {
                    db.createObjectStore('messages', { keyPath: 'id' });
                }
                if (!db.objectStoreNames.contains('peers')) {
                    db.createObjectStore('peers', { keyPath: 'id' });
                }
            },
        });
    }

    async saveMessage(message: SOSMessage): Promise<void> {
        const db = await this.db;
        await db.put('messages', message);
    }

    async getMessage(id: string): Promise<SOSMessage | undefined> {
        const db = await this.db;
        return db.get('messages', id);
    }

    async getAllMessages(): Promise<SOSMessage[]> {
        const db = await this.db;
        return db.getAll('messages');
    }

    async getQueuedMessages(): Promise<SOSMessage[]> {
        const messages = await this.getAllMessages();
        return messages.filter(m => m.status === 'queued');
    }

    async updateMessageStatus(id: string, status: SOSMessage['status']): Promise<void> {
        const db = await this.db;
        const message = await db.get('messages', id);
        if (message) {
            message.status = status;
            await db.put('messages', message);
        }
    }

    async deleteMessage(id: string): Promise<void> {
        const db = await this.db;
        await db.delete('messages', id);
    }
}

export const offlineStorage = new OfflineStorage();
