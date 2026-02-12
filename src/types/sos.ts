export type SOSStatus = 'queued' | 'sent' | 'relayed' | 'received';

export interface SOSMessage {
    id: string;
    text: string;
    location?: {
        latitude: number;
        longitude: number;
        accuracy: number;
    };
    timestamp: number;
    status: SOSStatus;
    isAutoTriggered: boolean;
    senderId: string;
    hops: number;
}

export interface PeerInfo {
    id: string;
    lastSeen: number;
    status: 'online' | 'offline';
}
