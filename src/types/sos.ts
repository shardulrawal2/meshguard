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
    /**
     * True when triggered explicitly from the Panic button.
     * Used for UI tinting and prioritisation.
     */
    isPanic?: boolean;
    /**
     * Optional human-readable fall severity, attached to auto fall messages.
     * Example: "light", "moderate", "severe", "critical".
     */
    fallSeverity?: 'light' | 'moderate' | 'severe' | 'critical';
    /**
     * Approximate impact value used for severity classification.
     */
    fallImpact?: number;
    senderId: string;
    hops: number;
}

export interface PeerInfo {
    id: string;
    lastSeen: number;
    status: 'online' | 'offline';
}
