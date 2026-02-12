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
        for (const [id, signal] of this.savedPeers) {
            try { await this.receiveConnection(signal); } catch (e) { }
        }
    }

    private handleBroadcastMessage(event: MessageEvent) {
        const { type, sender, target, signal } = event.data;
        if (sender === this.myId || (target && target !== this.myId)) return;
        if (type === 'presence' && !this.peers.has(sender)) {
            this.createPeer(true, undefined, sender);
        } else if (type === 'signal') {
            if (!this.peers.has(sender)) {
                if (signal.type === 'offer') this.createPeer(false, signal, sender);
            } else {
                this.peers.get(sender).signal(signal);
            }
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
            config: { iceServers: [] } // PURE OFFLINE
        });

        const peerId = remotePeerId || `qr-${Math.random().toString(36).substr(2, 5)}`;
        let gatheringTimeout: any = null;

        peer.on('signal', (data: any) => {
            if (remotePeerId) {
                this.broadcastChannel.postMessage({ type: 'signal', sender: this.myId, target: remotePeerId, signal: data });
            } else {
                if (gatheringTimeout) clearTimeout(gatheringTimeout);
                gatheringTimeout = setTimeout(() => {
                    const minified = this.minifySignal(data);
                    this.lastSignal = minified;
                    if (this.onSignalCallback) this.onSignalCallback(minified);
                }, 800);
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

        peer.on('error', (err: any) => {
            this.peers.delete(peerId);
            if (this.onPeerCountChange) this.onPeerCountChange(this.peers.size);
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
        if (!signal.sdp) return LZString.compressToEncodedURIComponent(type);
        const lines = signal.sdp.split('\r\n');
        const getValue = (pre: string) => (lines.find((l: any) => l.startsWith(pre)) || '').substring(pre.length).trim();

        const packed = {
            t: type,
            u: getValue('a=ice-ufrag:'),
            p: getValue('a=ice-pwd:'),
            f: getValue('a=fingerprint:').split(' ')[1] || '',
            c: lines.filter((l: any) => l.startsWith('a=candidate:')).slice(0, 4).map((l: any) => l.replace('a=candidate:', '').trim()).join(';')
        };
        return LZString.compressToEncodedURIComponent(JSON.stringify(packed));
    }

    public expandSignal(compressed: string): any {
        try {
            const json = LZString.decompressFromEncodedURIComponent(compressed);
            if (!json) return null;
            const packed = JSON.parse(json);
            const isOffer = packed.t === '1' || packed.type === 'offer';

            if (packed.u) {
                const candidates = (packed.c || '').split(';');
                const parts = (candidates[0] || '').split(' ');
                const ipVer = parts[5] === 'IP6' ? '6' : '4';
                const cLineIp = parts[4] || '0.0.0.0';

                const sdp = [
                    'v=0',
                    `o=- ${Date.now()} 1 IN IP4 127.0.0.1`,
                    's=-', 't=0 0', 'a=group:BUNDLE 0',
                    'm=application 9 DTLS/SCTP 5000',
                    `c=IN IP${ipVer} ${cLineIp}`,
                    `a=ice-ufrag:${packed.u}`,
                    `a=ice-pwd:${packed.p}`,
                    `a=fingerprint:sha-256 ${packed.f}`,
                    `a=setup:${isOffer ? 'actpass' : 'active'}`,
                    'a=mid:0', 'a=rtcp-mux', 'a=rtcp-rsize',
                    'a=sctpmap:5000 webrtc-datachannel 1024',
                    ...candidates.map((c: string) => `a=candidate:${c}`)
                ].join('\r\n') + '\r\n';
                return { type: isOffer ? 'offer' : 'answer', sdp };
            }
            return { type: isOffer ? 'offer' : 'answer', sdp: '' };
        } catch (e) { return null; }
    }

    private async handleIncomingMessage(message: SOSMessage, fromPeerId: string) {
        if (await offlineStorage.getMessage(message.id)) return;
        message.status = 'received';
        await offlineStorage.saveMessage(message);
        this.onMessageCallbacks.forEach(cb => cb(message));
        if (message.hops < 5) this.broadcast(message, [fromPeerId]);
    }

    broadcast(message: SOSMessage, exclude: string[] = []) {
        const payload = JSON.stringify({ ...message, hops: (message.hops || 0) + 1 });
        this.peers.forEach((peer, id) => { if (!exclude.includes(id)) try { peer.send(payload); } catch (err) { } });
    }

    onMessage(cb: (m: SOSMessage) => void) { this.onMessageCallbacks.push(cb); }
    onPeerCountChanged(cb: (c: number) => void) { this.onPeerCountChange = cb; }
    onPeerError(cb: (e: string) => void) { this.onPeerErrorCallback = cb; }
    getPeerCount() { return this.peers.size; }
    getConnectedPeerIds() { return Array.from(this.peers.keys()); }
}

export const p2pMesh = new P2pMesh();
