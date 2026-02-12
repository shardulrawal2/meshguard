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
    private pendingInitiator: any = null;

    constructor() {
        this.myId = `p-${Math.random().toString(36).substr(2, 6)}`;
        this.broadcastChannel = new BroadcastChannel('meshguard-signaling');
        this.broadcastChannel.onmessage = this.handleBroadcastMessage.bind(this);
        this.broadcastChannel.postMessage({ type: 'presence', sender: this.myId });
        this.loadSavedPeers();
        this.startAutoReconnectLoop();
    }

    private async loadSavedPeers() {
        try {
            const db = await offlineStorage['db'];
            const tx = db.transaction('peers', 'readonly');
            const store = tx.objectStore('peers');
            const allPeers = await store.getAll();
            allPeers.forEach((p: any) => this.savedPeers.set(p.id, p.signal));
        } catch (err) { }
    }

    private async savePeerSignal(peerId: string, signal: any) {
        try {
            const db = await offlineStorage['db'];
            const tx = db.transaction('peers', 'readwrite');
            const store = tx.objectStore('peers');
            await store.put({ id: peerId, signal, timestamp: Date.now() });
            this.savedPeers.set(peerId, signal);
        } catch (err) { }
    }

    private startAutoReconnectLoop() {
        setInterval(() => {
            if (this.peers.size === 0 && this.savedPeers.size > 0) this.reconnectToSavedPeers();
        }, 20000);
    }

    async reconnectToSavedPeers() {
        for (const [_id, signal] of this.savedPeers) {
            try { await this.receiveConnection(signal); } catch (_e) { }
        }
    }

    private handleBroadcastMessage(event: MessageEvent) {
        const { type, sender, target, signal } = event.data;
        if (sender === this.myId || (target && target !== this.myId)) return;

        try {
            if (type === 'presence' && !this.peers.has(sender)) {
                console.log('[P2pMesh] Auto-discovery: Creating peer for', sender);
                this.createPeer(true, undefined, sender);
            } else if (type === 'signal') {
                if (!this.peers.has(sender)) {
                    if (signal.type === 'offer') {
                        console.log('[P2pMesh] Auto-discovery: Accepting offer from', sender);
                        this.createPeer(false, signal, sender);
                    }
                } else {
                    const peer = this.peers.get(sender);
                    if (peer && !peer.destroyed) {
                        peer.signal(signal);
                    }
                }
            }
        } catch (err) {
            console.error('[P2pMesh] Broadcast message error:', err);
        }
    }

    initiateConnection() {
        this.lastSignal = null;
        const peer = this.createPeer(true);
        this.pendingInitiator = peer;
        return peer;
    }

    receiveConnection(signal: any) {
        this.lastSignal = null;
        return this.createPeer(false, signal);
    }

    completeHandshake(signal: any) {
        if (this.pendingInitiator) {
            this.pendingInitiator.signal(signal);
            this.pendingInitiator = null;
        }
    }

    private createPeer(initiator: boolean, remoteSignal?: any, remotePeerId?: string) {
        const peer = new SimplePeer({
            initiator,
            trickle: false,
            config: { iceServers: [] }, // PURE OFFLINE
        });

        const peerId = remotePeerId || `qr-${Math.random().toString(36).substr(2, 5)}`;
        let gatheringTimeout: any = null;

        peer.on('signal', (data: any) => {
            if (remotePeerId) {
                this.broadcastChannel.postMessage({ type: 'signal', sender: this.myId, target: remotePeerId, signal: data });
            } else {
                if (gatheringTimeout) clearTimeout(gatheringTimeout);
                gatheringTimeout = setTimeout(() => {
                    if (!data || !data.sdp) {
                        console.warn('[P2pMesh] Invalid signal data received');
                        return;
                    }
                    const minified = this.minifySignal(data);
                    this.lastSignal = minified;
                    if (this.onSignalCallback) this.onSignalCallback(minified);
                }, 1500); // 1.5s delay to ensure all host candidates are gathered
            }
        });

        peer.on('connect', () => {
            this.peers.set(peerId, peer);
            if (!initiator && remoteSignal) this.savePeerSignal(peerId, remoteSignal);
            if (this.onPeerCountChange) this.onPeerCountChange(this.peers.size);
        });

        peer.on('data', (data: any) => {
            try { this.handleIncomingMessage(JSON.parse(data.toString()), peerId); } catch (e) { }
        });

        peer.on('error', (_err: any) => {
            console.error('[P2pMesh] Peer error:', _err);
            this.peers.delete(peerId);
            if (this.onPeerCountChange) this.onPeerCountChange(this.peers.size);
            if (this.onPeerErrorCallback) this.onPeerErrorCallback(_err.message || 'Peer Connection Failed');
        });

        peer.on('close', () => {
            this.peers.delete(peerId);
            if (this.onPeerCountChange) this.onPeerCountChange(this.peers.size);
        });

        if (remoteSignal) peer.signal(remoteSignal);
        return peer;
    }

    onSignal(callback: (signal: string) => void) {
        this.onSignalCallback = callback;
        if (this.lastSignal) callback(this.lastSignal);
    }

    private minifySignal(signal: any): string {
        const type = signal.type === 'offer' ? '1' : '2';
        const packed: any = { t: type };

        if (signal.sdp) {
            const lines = signal.sdp.split('\r\n');
            const getValue = (pre: string) => (lines.find((l: any) => l.startsWith(pre)) || '').substring(pre.length).trim();

            packed.u = getValue('a=ice-ufrag:');
            packed.p = getValue('a=ice-pwd:');
            packed.f = (getValue('a=fingerprint:').split(' ')[1] || '');

            // Prioritize Host and IPv4 candidates
            const candidates = lines.filter((l: any) => l.startsWith('a=candidate:'));
            const prioritized = candidates
                .filter((l: any) => l.includes('host') && l.includes('IP4'))
                .slice(0, 5)
                .map((l: any) => l.replace('a=candidate:', '').trim());

            // Fallback to any candidates if no host IPv4 found
            packed.c = (prioritized.length > 0 ? prioritized : candidates.slice(0, 3).map((l: any) => l.replace('a=candidate:', '').trim())).join(';');
        }
        return LZString.compressToEncodedURIComponent(JSON.stringify(packed));
    }

    public expandSignal(compressed: string): any {
        try {
            const json = LZString.decompressFromEncodedURIComponent(compressed);
            if (!json) return null;

            let packed: any;
            try {
                packed = JSON.parse(json);
            } catch (e) {
                // Backward compatibility for single character signal
                packed = { t: json };
            }

            const isOffer = packed.t === '1' || packed.type === 'offer';

            if (packed.u) {
                const candidates = (packed.c || '').split(';');
                const firstCandidate = candidates[0] || '';
                const parts = firstCandidate.split(' ');

                // Extract best IP for c= line. Use IP4 if found, default to 127.0.0.1
                const ipVer = parts[5] === 'IP6' ? '6' : '4';
                const cLineIp = (parts[4] && parts[4] !== '0.0.0.0') ? parts[4] : '127.0.0.1';

                const sdp = [
                    'v=0',
                    `o=- ${Math.floor(Date.now() / 1000)} ${Math.floor(Date.now() / 1000)} IN IP4 ${cLineIp}`,
                    's=-',
                    't=0 0',
                    'a=msid-semantic: WMS',
                    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
                    `c=IN IP${ipVer} ${cLineIp}`,
                    `a=ice-ufrag:${packed.u}`,
                    `a=ice-pwd:${packed.p}`,
                    `a=fingerprint:sha-256 ${packed.f}`,
                    `a=setup:${isOffer ? 'actpass' : 'active'}`,
                    'a=mid:0',
                    'a=sctp-port:5000',
                    'a=max-message-size:262144',
                    ...candidates.filter((c: string) => c.trim()).map((c: string) => `a=candidate:${c}`)
                ].join('\r\n') + '\r\n';

                return { type: isOffer ? 'offer' : 'answer', sdp };
            }
            return { type: isOffer ? 'offer' : 'answer', sdp: '' };
        } catch (e) {
            console.error('[P2pMesh] Expand signal error:', e);
            return null;
        }
    }

    private async handleIncomingMessage(message: SOSMessage, fromPeerId: string) {
        try {
            // Prevent duplicate processing
            if (await offlineStorage.getMessage(message.id)) {
                console.log('[P2pMesh] Duplicate message ignored:', message.id);
                return;
            }

            message.status = 'received';
            await offlineStorage.saveMessage(message);

            console.log('[P2pMesh] New message received:', message.id);
            this.onMessageCallbacks.forEach(cb => {
                try { cb(message); } catch (err) { console.error('[P2pMesh] Callback error:', err); }
            });

            // Relay to mesh if within hop limit
            if (message.hops < 5) {
                this.broadcast(message, [fromPeerId]);
            }
        } catch (err) {
            console.error('[P2pMesh] Message handling error:', err);
        }
    }

    broadcast(message: SOSMessage, exclude: string[] = []) {
        const payload = JSON.stringify({ ...message, hops: (message.hops || 0) + 1 });
        let successCount = 0;
        let failCount = 0;

        this.peers.forEach((peer, id) => {
            if (!exclude.includes(id)) {
                try {
                    if (!peer.destroyed && peer.connected) {
                        peer.send(payload);
                        successCount++;
                    } else {
                        failCount++;
                    }
                } catch (err) {
                    console.error('[P2pMesh] Broadcast failed to peer', id, err);
                    failCount++;
                }
            }
        });

        console.log(`[P2pMesh] Broadcast: ${successCount} sent, ${failCount} failed`);
    }

    onMessage(cb: (m: SOSMessage) => void) { this.onMessageCallbacks.push(cb); }
    onPeerCountChanged(cb: (c: number) => void) { this.onPeerCountChange = cb; }
    onPeerError(cb: (e: string) => void) { this.onPeerErrorCallback = cb; }
    getPeerCount() { return this.peers.size; }
    getConnectedPeerIds() { return Array.from(this.peers.keys()); }
}

export const p2pMesh = new P2pMesh();
