import type { SOSMessage } from '../types/sos';
import { p2pMesh } from './P2pMesh';

export class BluetoothService {
    private serviceUuid = '0000ff01-0000-1000-8000-00805f9b34fb';
    private charUuid = '0000ff02-0000-1000-8000-00805f9b34fb';
    private connectedDevices: Map<string, any> = new Map();
    private onMessageCallback: ((msg: SOSMessage) => void) | null = null;
    private onSignalCallback: ((senderId: string, signal: any) => void) | null = null;

    // ECDH State
    private keyPair: CryptoKeyPair | null = null;
    private sharedSecrets: Map<string, CryptoKey> = new Map();

    constructor() {
        this.initECDH();
    }

    private async initECDH() {
        try {
            // Using P-256 for maximum browser compatibility (ECDH)
            this.keyPair = await window.crypto.subtle.generateKey(
                { name: "ECDH", namedCurve: "P-256" },
                true,
                ["deriveKey"]
            );
        } catch (err) {
            console.error('[Bluetooth] ECDH Init Error:', err);
        }
    }

    async getPublicKey() {
        if (!this.keyPair) await this.initECDH();
        const exported = await window.crypto.subtle.exportKey("raw", this.keyPair!.publicKey);
        return btoa(String.fromCharCode(...new Uint8Array(exported)));
    }

    async deriveSharedSecret(peerPublicKeyBase64: string, peerId: string) {
        if (!this.keyPair) return;
        try {
            const peerPubKeyRaw = new Uint8Array(atob(peerPublicKeyBase64).split("").map(c => c.charCodeAt(0)));
            const peerPublicKey = await window.crypto.subtle.importKey(
                "raw",
                peerPubKeyRaw,
                { name: "ECDH", namedCurve: "P-256" },
                true,
                []
            );

            const sharedSecret = await window.crypto.subtle.deriveKey(
                { name: "ECDH", public: peerPublicKey },
                this.keyPair.privateKey,
                { name: "AES-GCM", length: 256 },
                true,
                ["encrypt", "decrypt"]
            );

            this.sharedSecrets.set(peerId, sharedSecret);
            return true;
        } catch (err) {
            console.error('[Bluetooth] Secret Derivation Error:', err);
            return false;
        }
    }

    async scanAndConnect(targetPeerId: string) {
        if (!this.isSupported()) return false;

        try {
            // Filter by the short ID discovered via QR
            const device = await (navigator as any).bluetooth.requestDevice({
                filters: [{ name: `MeshGuard-${targetPeerId}` }],
                optionalServices: [this.serviceUuid]
            });

            const server = await device.gatt?.connect();
            if (server) {
                this.connectedDevices.set(device.id, server);
                await this.setupNotifications(server);
                return true;
            }
        } catch (err) {
            console.error('[Bluetooth] Connection failed:', err);
        }
        return false;
    }

    private async setupNotifications(server: any) {
        try {
            const service = await server.getPrimaryService(this.serviceUuid);
            const characteristic = await service.getCharacteristic(this.charUuid);

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', async (event: any) => {
                const value = event.target.value;
                const decoder = new TextDecoder();
                const json = decoder.decode(value);
                const data = JSON.parse(json);

                if (data.type === 'signal' && this.onSignalCallback) {
                    this.onSignalCallback(data.sender, data.signal);
                } else if (data.type === 'message' && this.onMessageCallback) {
                    this.onMessageCallback(data.payload);
                }
            });
        } catch (err) {
            console.error('[Bluetooth] Notification error:', err);
        }
    }

    async sendSignal(_peerId: string, signal: any) {
        const payload = JSON.stringify({
            type: 'signal',
            sender: p2pMesh.myId,
            signal: signal
        });
        await this.broadcastRaw(payload);
    }

    private async broadcastRaw(data: string) {
        const encoder = new TextEncoder();
        const payload = encoder.encode(data);
        for (const [id, server] of this.connectedDevices) {
            try {
                const service = await server.getPrimaryService(this.serviceUuid);
                const characteristic = await service.getCharacteristic(this.charUuid);
                // In real BLE, we might need to chunk this if > 20 bytes
                await characteristic.writeValue(payload);
            } catch (err) {
                this.connectedDevices.delete(id);
            }
        }
    }

    async broadcast(message: SOSMessage) {
        const payload = JSON.stringify({ type: 'message', payload: message });
        await this.broadcastRaw(payload);
    }

    onSignal(callback: (senderId: string, signal: any) => void) {
        this.onSignalCallback = callback;
    }

    onMessage(callback: (msg: SOSMessage) => void) {
        this.onMessageCallback = callback;
    }

    isSupported() {
        return typeof navigator !== 'undefined' && !!(navigator as any).bluetooth;
    }

    getDeviceCount() {
        return this.connectedDevices.size;
    }
}

export const bluetoothService = new BluetoothService();
