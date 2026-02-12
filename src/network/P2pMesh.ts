// @ts-ignore
import SimplePeer from 'simple-peer/simplepeer.min.js';
import type { SOSMessage } from '../types/sos';
import { offlineStorage } from '../services/OfflineStorage';
import LZString from 'lz-string';

export class P2pMesh {
    private peers: Map<string, any> = new Map();
    private onMessageCallbacks: ((message: SOSMessage) => void)[] = [];
    private onSignalCallback: ((signal: any) => void) | null = null;
    private lastSignal: any = null;
    private onPeerCountChange: ((count: number) => void) | null = null;
    private onPeerErrorCallback: ((err: string) => void) | null = null;
    private savedPeers: Map<string, any> = new Map();
    private broadcastChannel: BroadcastChannel;
    public myId: string;
    private pendingInitiator: any = null; // Track the peer waiting for an answer

    constructor() {
        this.myId = `p-${Math.random().toString(36).substr(2, 6)}`; // Shorter ID
        console.log(`[P2pMesh] Initialized as ${this.myId}`);

        this.broadcastChannel = new BroadcastChannel('meshguard-signaling');
        this.broadcastChannel.onmessage = this.handleBroadcastMessage.bind(this);

        // Announce presence to other tabs
        this.broadcastChannel.postMessage({ type: 'presence', sender: this.myId });

        this.loadSavedPeers();
        this.startAutoReconnectLoop();
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
            console.log(`[P2pMesh] Saved peer ${peerId} for reconnection`);
        } catch (err: any) {
            console.warn('[P2pMesh] Could not save peer:', err);
        }
    }

    // Auto-reconnect loop runs every 20s to restore broken links
    private startAutoReconnectLoop() {
        setInterval(() => {
            if (this.peers.size === 0 && this.savedPeers.size > 0) {
                console.log('[P2pMesh] Auto-recovery: Attempting to find saved peers...');
                this.reconnectToSavedPeers();
            }
        }, 20000);
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

    initiateConnection(remotePeerId?: string) {
        this.lastSignal = null;
        const peer = this.createPeer(true, undefined, remotePeerId);
        this.pendingInitiator = peer;
        return peer;
    }

    // New method to respond to a connection attempt
    receiveConnection(signalData: any, remotePeerId?: string) {
        this.lastSignal = null; // Clear old signals before starting responder
        return this.createPeer(false, signalData, remotePeerId);
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
            config: {
                iceServers: [], // Disable STUN to prevent pairing delays/stalls when offline
                iceTransportPolicy: 'all',
                iceCandidatePoolSize: 10
            }
        });

        // Use remotePeerId if provided (auto-discovery), otherwise generate temp ID (QR scan)
        const peerId = remotePeerId || `qr-${Math.random().toString(36).substr(2, 5)}`;

        let signalBatch: any = null;
        let gatheringTimeout: any = null;

        peer.on('signal', (data: any) => {
            signalBatch = data;

            // If we know the remote peer ID (Auto-Discovery), send signal via BroadcastChannel instantly
            if (remotePeerId) {
                this.broadcastChannel.postMessage({
                    type: 'signal',
                    sender: this.myId,
                    target: remotePeerId,
                    signal: data
                });
            } else {
                // MACROSCOPIC QR FLOW: Wait for candidates to settle (v6.1)
                if (gatheringTimeout) clearTimeout(gatheringTimeout);

                gatheringTimeout = setTimeout(() => {
                    if (!signalBatch) return;
                    const minified = this.minifySignal(signalBatch);
                    this.lastSignal = minified;

                    if (this.onSignalCallback) this.onSignalCallback(minified);
                }, 800);
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
            const errMsg = err.message || JSON.stringify(err);
            console.error(`[P2pMesh] Peer error (${peerId}):`, errMsg);
            if (this.onPeerErrorCallback) this.onPeerErrorCallback(errMsg);
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
    onSignal(callback: (signal: string) => void) {
        this.onSignalCallback = callback;
        if (this.lastSignal) {
            callback(this.lastSignal);
        }
    }

    // MICRO-LINK v5: Robust Key-Value SDP Compression
    private minifySignal(signal: any): string {
        const type = signal.type === 'offer' ? '1' : '2';
        if (!signal.sdp) return LZString.compressToEncodedURIComponent(type);

        const lines = signal.sdp.split('\r\n');

        const getValue = (prefix: string) => {
            const line = lines.find((l: string) => l.startsWith(prefix));
            return line ? line.substring(prefix.length).trim() : '';
        };

        const ufrag = getValue('a=ice-ufrag:');
        const pwd = getValue('a=ice-pwd:');
        const fpLine = getValue('a=fingerprint:'); // e.g. "sha-256 XX:XX..."
        const fingerprintAlg = fpLine ? fpLine.split(' ')[0] : 'sha-256';
        const fingerprint = fpLine ? fpLine.split(' ')[1] : '';
        const setup = getValue('a=setup:');

        // Keep TOP 4 candidates (including srflx if host is missing) for hotspot reliability
        const candidates = lines
            .filter((l: string) => l.startsWith('a=candidate:'))
            .slice(0, 4)
            .map((c: string) => c.replace('a=candidate:', '').trim());

        // Use a compact Key-Value format
        const packed = {
            t: type,
            u: ufrag,
            p: pwd,
            a: fingerprintAlg,
            f: fingerprint,
            s: setup || 'actpass',
            c: candidates.join(';')
        };

        return LZString.compressToEncodedURIComponent(JSON.stringify(packed));
    }

    public expandSignal(compressed: string): any {
        try {
            const json = LZString.decompressFromEncodedURIComponent(compressed);
            if (!json) return null;

            const packed = JSON.parse(json);
            const { t, u, p, a, f, s, c } = packed;

            const signal: any = {
                type: t === '1' ? 'offer' : 'answer',
                sdp: ''
            };

            if (u) {
                const candidates = c ? c.split(';') : [];

                // Extract possible IP from first candidate for the c-line fallback
                const firstCand = candidates[0] || '';
                const parts = firstCand.split(' ');
                const cLineIp = parts.length > 4 ? parts[4] : '0.0.0.0';

                const sdpLines = [
                    'v=0',
                    `o=- ${Math.floor(Date.now() / 1000)} ${Math.floor(Math.random() * 100)} IN IP4 127.0.0.1`,
                    's=-',
                    't=0 0',
                    'a=group:BUNDLE 0',
                    'm=application 9 DTLS/SCTP 5000',
                    `c=IN IP4 ${cLineIp}`,
                    `a=ice-ufrag:${u}`,
                    `a=ice-pwd:${p}`,
                    `a=fingerprint:${a || 'sha-256'} ${f}`,
                    `a=setup:${s}`,
                    'a=mid:0',
                    'a=rtcp-mux',
                    'a=rtcp-rsize',
                    'a=sctpmap:5000 webrtc-datachannel 1024',
                    ...candidates.map((cand: string) => `a=candidate:${cand}`)
                ];
                signal.sdp = sdpLines.map(l => l.trim()).filter(Boolean).join('\r\n') + '\r\n';
            }
            return signal;
        } catch (e) {
            console.error('[P2pMesh] Failed to expand signal', e);
            return null;
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

    onPeerError(callback: (err: string) => void) {
        this.onPeerErrorCallback = callback;
    }

    getPeerCount() {
        return this.peers.size;
    }

    getConnectedPeerIds(): string[] {
        return Array.from(this.peers.keys());
    }
}

export const p2pMesh = new P2pMesh();
