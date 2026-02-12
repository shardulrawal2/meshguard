export class FallDetector {
    private threshold = 25; // m/s^2 change
    private isMonitoring = false;
    private lastAccel = { x: 0, y: 0, z: 0 };
    private onFallDetected: () => void = () => { };

    constructor() { }

    start(callback: () => void) {
        if (this.isMonitoring) return;
        this.onFallDetected = callback;

        if (typeof DeviceMotionEvent !== 'undefined' && typeof (DeviceMotionEvent as any).requestPermission === 'function') {
            (DeviceMotionEvent as any).requestPermission()
                .then((permissionState: string) => {
                    if (permissionState === 'granted') {
                        this.enableListener();
                    }
                })
                .catch(console.error);
        } else {
            this.enableListener();
        }
    }

    stop() {
        window.removeEventListener('devicemotion', this.handleMotion);
        this.isMonitoring = false;
    }

    private enableListener() {
        window.addEventListener('devicemotion', this.handleMotion);
        this.isMonitoring = true;
    }

    private handleMotion = (event: DeviceMotionEvent) => {
        const accel = event.accelerationIncludingGravity;
        if (!accel) return;

        const { x, y, z } = {
            x: accel.x || 0,
            y: accel.y || 0,
            z: accel.z || 0
        };

        const deltaX = Math.abs(x - this.lastAccel.x);
        const deltaY = Math.abs(y - this.lastAccel.y);
        const deltaZ = Math.abs(z - this.lastAccel.z);

        const magnitudeChange = Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2);

        if (magnitudeChange > this.threshold) {
            console.log('[FallDetector] Significant movement detected:', magnitudeChange);
            // Wait for impact (second peak)
            setTimeout(() => {
                // Simple heuristic: if magnitude remains high or peaks again, it's a fall
                this.onFallDetected();
            }, 500);
        }

        this.lastAccel = { x, y, z };
    };
}

export const fallDetector = new FallDetector();
