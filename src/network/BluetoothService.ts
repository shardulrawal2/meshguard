import type { SOSMessage } from '../types/sos';

export class BluetoothService {
    private serviceUuid = '0000ff01-0000-1000-8000-00805f9b34fb';
    private charUuid = '0000ff02-0000-1000-8000-00805f9b34fb';
    private connectedDevices: Map<string, any> = new Map();
    private onMessageCallback: ((msg: SOSMessage) => void) | null = null;

    constructor() { }

    async scanAndConnect() {
        // @ts-ignore
        if (typeof navigator === 'undefined' || !navigator.bluetooth) {
            console.warn('Web Bluetooth not supported.');
            return false;
        }

        try {
            // @ts-ignore
            const device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.serviceUuid] }],
                optionalServices: [this.serviceUuid]
            });

            const server = await device.gatt?.connect();
            if (server) {
                this.connectedDevices.set(device.id, server);
                await this.setupNotifications(server);
                return true;
            }
        } catch (err) {
            console.error('[Bluetooth] Error:', err);
        }
        return false;
    }

    private async setupNotifications(server: any) {
        try {
            const service = await server.getPrimaryService(this.serviceUuid);
            const characteristic = await service.getCharacteristic(this.charUuid);

            await characteristic.startNotifications();
            characteristic.addEventListener('characteristicvaluechanged', (event: any) => {
                const value = event.target.value;
                const decoder = new TextDecoder();
                const json = decoder.decode(value);
                const message: SOSMessage = JSON.parse(json);
                if (this.onMessageCallback) this.onMessageCallback(message);
            });
        } catch (err) {
            console.error('[Bluetooth] Notification error:', err);
        }
    }

    async broadcast(message: SOSMessage) {
        const payload = new TextEncoder().encode(JSON.stringify(message));
        for (const [id, server] of this.connectedDevices) {
            try {
                const service = await server.getPrimaryService(this.serviceUuid);
                const characteristic = await service.getCharacteristic(this.charUuid);
                await characteristic.writeValue(payload);
            } catch (err) {
                console.error(`[Bluetooth] Send error ${id}:`, err);
                this.connectedDevices.delete(id);
            }
        }
    }

    onMessage(callback: (msg: SOSMessage) => void) {
        this.onMessageCallback = callback;
    }

    isSupported() {
        // @ts-ignore
        return typeof navigator !== 'undefined' && !!navigator.bluetooth;
    }

    getDeviceCount() {
        return this.connectedDevices.size;
    }
}

export const bluetoothService = new BluetoothService();
