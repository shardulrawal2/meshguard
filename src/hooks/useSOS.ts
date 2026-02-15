import { useState, useEffect } from 'react';
import type { SOSMessage } from '../types/sos';
import { offlineStorage } from '../services/OfflineStorage';
import { p2pMesh } from '../network/P2pMesh';

export const useSOS = () => {
    const [messages, setMessages] = useState<SOSMessage[]>([]);
    const [isOnline, setIsOnline] = useState(navigator.onLine);

    useEffect(() => {
        const loadMessages = async () => {
            const stored = await offlineStorage.getAllMessages();
            setMessages(stored.sort((a, b) => b.timestamp - a.timestamp));
        };

        loadMessages();

        // WebRTC Mesh listener
        p2pMesh.onMessage((msg) => {
            setMessages(prev => [msg, ...prev]);
        });


        const handleStatus = () => setIsOnline(navigator.onLine);
        window.addEventListener('online', handleStatus);
        window.addEventListener('offline', handleStatus);

        return () => {
            window.removeEventListener('online', handleStatus);
            window.removeEventListener('offline', handleStatus);
        };
    }, []);

    const sendSOS = async (text: string, isAuto = false) => {
        const message: SOSMessage = {
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `msg-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            text,
            timestamp: Date.now(),
            status: 'queued',
            isAutoTriggered: isAuto,
            senderId: 'local-user', // Use a persistent ID in production
            hops: 0,
        };

        // Get location if possible
        try {
            const pos = await new Promise<GeolocationPosition>((resolve, reject) => {
                navigator.geolocation.getCurrentPosition(resolve, reject, { timeout: 5000 });
            });
            message.location = {
                latitude: pos.coords.latitude,
                longitude: pos.coords.longitude,
                accuracy: pos.coords.accuracy,
            };
        } catch (err) {
            console.warn('Location retrieval failed or denied', err);
        }

        await offlineStorage.saveMessage(message);
        setMessages(prev => [message, ...prev]);

        // Attempt broadcast to connected peers
        const peerCount = p2pMesh.getPeerCount();
        if (peerCount > 0) {
            console.log(`[useSOS] Broadcasting to ${peerCount} peers`);
            p2pMesh.broadcast(message);
        } else {
            console.log('[useSOS] No peers connected, message queued locally');
        }

        return message;
    };

    const sendTestMessage = async () => {
        const testMessage: SOSMessage = {
            id: typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : `test-${Date.now()}`,
            text: '🧪 Test Message - Mesh Network Active',
            timestamp: Date.now(),
            status: 'sent',
            isAutoTriggered: false,
            senderId: 'local-user',
            hops: 0,
        };

        await offlineStorage.saveMessage(testMessage);
        setMessages(prev => [testMessage, ...prev]);
        
        const peerCount = p2pMesh.getPeerCount();
        if (peerCount > 0) {
            console.log(`[useSOS] Test message broadcasting to ${peerCount} peers`);
            p2pMesh.broadcast(testMessage);
        }
        
        return testMessage;
    };

    return { messages, isOnline, sendSOS, sendTestMessage };
};
