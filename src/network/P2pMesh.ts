// @ts-ignore
import SimplePeer from 'simple-peer/simplepeer.min.js';
import type { SOSMessage } from '../types/sos';
import { offlineStorage } from '../services/OfflineStorage';

export class P2pMesh {
    private peers: Map<string, any> = new Map();
    private onMessageCallbacks: ((message: SOSMessage) => void)[] = [];
    private onSignalCallback: ((signal: any) => void) | null = null;
    private lastSignal: any = null;
    private onPeerCountChange: ((count: number) => void) | null = null;
    private savedPeers: Map<string, any> = new Map(); // Store peer signals for reconnection
    private broadcastChannel: BroadcastChannel;
    private myId: string;
    private pendingInitiator: any = null; // Track the peer waiting for an answer

    constructor() {
        this.myId = `peer-${Math.random().toString(36).substr(2, 9)}`;
        console.log(`[P2pMesh] Initialized as ${this.myId}`);

        this.broadcastChannel = new BroadcastChannel('meshguard-signaling');
        this.broadcastChannel.onmessage = this.handleBroadcastMessage.bind(this);

        // Announce presence to other tabs
        this.broadcastChannel.postMessage({ type: 'presence', sender: this.myId });

        this.loadSavedPeers();
    }

    // Load saved peer signals from IndexedDB
    private async loadSavedPeers() {
        try {
            const db = await offlineStorage['db'];
            const tx = db.transaction('peers', 'readonly');
            const store = tx.objectStore('peers');
            const allPeers = await store.getAll();

            allPeers.forEach((peerData: any) => {
                this.savedPeers.set(peerData.id, peerData.signal);
            });

            console.log(`[P2pMesh] Loaded ${allPeers.length} saved peers`);
        } catch (err: any) {
            console.warn('[P2pMesh] Could not load saved peers:', err);
        }
    }

    // Save peer signal for future reconnection
    private async savePeerSignal(peerId: string, signal: any) {
        try {
            const db = await offlineStorage['db'];
            const tx = db.transaction('peers', 'readwrite');
            const store = tx.objectStore('peers');
            await store.put({ id: peerId, signal, timestamp: Date.now() });
            this.savedPeers.set(peerId, signal);
            this.savedPeers.set(peerId, signal);
            console.log(`[P2pMesh] Saved peer ${peerId} for reconnection`);
        } catch (err: any) {
            console.warn('[P2pMesh] Could not save peer:', err);
        }
    }

    // Auto-reconnect to saved peers
    async reconnectToSavedPeers() {
        console.log(`[P2pMesh] Attempting to reconnect to ${this.savedPeers.size} saved peers`);
        for (const [peerId, signal] of this.savedPeers) {
            try {
                await this.receiveConnection(signal);
            } catch (err: any) {
                console.warn(`[P2pMesh] Failed to reconnect to ${peerId}:`, err);
            }
        }
    }

    private handleBroadcastMessage(event: MessageEvent) {
        const { type, sender, target, signal } = event.data;

        // Ignore messages from self or not meant for me
        if (sender === this.myId) return;
        if (target && target !== this.myId) return;

        if (type === 'presence') {
            // Found a new peer on the same device! Initiate connection.
            if (!this.peers.has(sender)) {
                console.log(`[P2pMesh] Discovered local peer ${sender}, initiating connection...`);
                this.createPeer(true, undefined, sender);
            }
        } else if (type === 'signal') {
            // Received a signaling message
            if (!this.peers.has(sender)) {
                // Received offer from initiator, create receiver peer
                if (signal.type === 'offer') {
                    console.log(`[P2pMesh] Accepting connection from ${sender}...`);
                    this.createPeer(false, signal, sender);
                }
            } else {
                // Existing peer, pass signal
                const peer = this.peers.get(sender);
                peer.signal(signal);
            }
        }
    }

    initiateConnection() {
        this.lastSignal = null;
        const peer = this.createPeer(true);
        this.pendingInitiator = peer;
        return peer;
    }

    // New method to respond to a connection attempt
    receiveConnection(signalData: any) {
        return this.createPeer(false, signalData);
    }

    // Complete the handshake by providing the answer signal to the initiator
    completeHandshake(signalData: any) {
        if (this.pendingInitiator) {
            console.log('[P2pMesh] Completing handshake with answer signal');
            this.pendingInitiator.signal(signalData);
            this.pendingInitiator = null; // Handshake complete
        } else {
            console.warn('[P2pMesh] No pending initiator found to complete handshake');
        }
    }

    private createPeer(initiator: boolean, remoteSignal?: any, remotePeerId?: string) {
        const peer = new SimplePeer({
            initiator,
            trickle: false,
        });

        // Use remotePeerId if provided (auto-discovery), otherwise generate temp ID (QR scan)
        const peerId = remotePeerId || `qr-${Math.random().toString(36).substr(2, 5)}`;

        peer.on('signal', (data: any) => {
            // If we know the remote peer ID (Auto-Discovery), send signal via BroadcastChannel
            if (remotePeerId) {
                this.broadcastChannel.postMessage({
                    type: 'signal',
                    sender: this.myId,
                    target: remotePeerId,
                    signal: data
                });
            } else {
                // Legacy QR flow
                console.log(`[P2pMesh] Signal generated (${data.type || 'candidate'}):`, data);
                this.lastSignal = data;
                if (this.onSignalCallback) this.onSignalCallback(data);
            }
        });

        // @ts-ignore
        peer._pc.onconnectionstatechange = () => {
            // @ts-ignore
            console.log(`[P2pMesh] Connection state: ${peer._pc.connectionState}`);
        };

        peer.on('connect', () => {
            console.log(`[P2pMesh] Connected to ${peerId}`);
            this.peers.set(peerId, peer);

            // Save peer for reconnection (only if we're the receiver)
            if (!initiator && remoteSignal) {
                this.savePeerSignal(peerId, remoteSignal);
            }

            // Notify UI of peer count change
            if (this.onPeerCountChange) {
                this.onPeerCountChange(this.peers.size);
            }
        });

        peer.on('data', (data: any) => {
            try {
                const message: SOSMessage = JSON.parse(data.toString());
                this.handleIncomingMessage(message, peerId);
            } catch (err: any) {
                console.error('[P2pMesh] Error parsing incoming data', err);
            }
        });

        peer.on('error', (err: any) => {
            console.error(`[P2pMesh] Peer error (${peerId}):`, err);
            this.peers.delete(peerId);
        });

        peer.on('close', () => {
            console.log(`[P2pMesh] Connection closed (${peerId})`);
            this.peers.delete(peerId);

            // Notify UI of peer count change
            if (this.onPeerCountChange) {
                this.onPeerCountChange(this.peers.size);
            }
        });

        if (remoteSignal) {
            peer.signal(remoteSignal);
        }

        return peer;
    }

    // For the UI to listen for signals generated by this peer
    onSignal(callback: (signal: any) => void) {
        this.onSignalCallback = callback;
        if (this.lastSignal) {
            callback(this.lastSignal);
        }
    }

    private async handleIncomingMessage(message: SOSMessage, fromPeerId: string) {
        console.log(`[P2pMesh] Received message from ${fromPeerId}:`, message);

        // Check if we already have this message (deduplicate)
        const existing = await offlineStorage.getMessage(message.id);
        if (existing) return;

        // Save and notify
        message.status = 'received';
        await offlineStorage.saveMessage(message);
        this.onMessageCallbacks.forEach(cb => cb(message));

        // Relay if hops < max (store-and-forward)
        if (message.hops < 5) {
            this.broadcast(message, [fromPeerId]);
        }
    }

    broadcast(message: SOSMessage, excludePeerIds: string[] = []) {
        const relayMessage = { ...message, hops: (message.hops || 0) + 1 };
        const payload = JSON.stringify(relayMessage);

        this.peers.forEach((peer, id) => {
            if (!excludePeerIds.includes(id)) {
                try {
                    peer.send(payload);
                    console.log(`[P2pMesh] Relayed message to ${id}`);
                } catch (err: any) {
                    console.error(`[P2pMesh] Failed to send to ${id}`, err);
                }
            }
        });
    }

    onMessage(callback: (message: SOSMessage) => void) {
        this.onMessageCallbacks.push(callback);
    }

    onPeerCountChanged(callback: (count: number) => void) {
        this.onPeerCountChange = callback;
    }

    getPeerCount() {
        return this.peers.size;
    }

    getConnectedPeerIds(): string[] {
        return Array.from(this.peers.keys());
    }
}

export const p2pMesh = new P2pMesh();
