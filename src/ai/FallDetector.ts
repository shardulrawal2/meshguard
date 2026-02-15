export interface FallEvent {
    impact: number;      // peak impact in m/s^2 (approx)
    severity: 'light' | 'moderate' | 'severe' | 'critical';
}

export class FallDetector {
    // Required impact change to consider a candidate fall sample
    private threshold = 50; // m/s^2 change

    // Require a short "burst" of high-impact samples to treat as a true fall
    private burstWindowMs = 700; // look-back window
    private minSamplesInBurst = 2;

    // Cooldown so a single fall does not trigger multiple alerts
    private cooldownMs = 15000;

    private isMonitoring = false;
    private lastAccel = { x: 0, y: 0, z: 0 };
    private lastFallTimestamp = 0;
    private recentImpacts: { t: number; v: number }[] = [];

    private onFallDetected: (event: FallEvent) => void = () => { };

    constructor() { }

    start(callback: (event: FallEvent) => void) {
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

        const now = Date.now();

        if (magnitudeChange > this.threshold) {
            // Track high-impact samples in a short sliding window
            this.recentImpacts.push({ t: now, v: magnitudeChange });
            this.recentImpacts = this.recentImpacts.filter(sample => now - sample.t <= this.burstWindowMs);

            const samplesInWindow = this.recentImpacts.length;
            const peakImpact = Math.max(...this.recentImpacts.map(s => s.v));

            if (
                samplesInWindow >= this.minSamplesInBurst &&
                (now - this.lastFallTimestamp > this.cooldownMs)
            ) {
                this.lastFallTimestamp = now;

                const severity = this.classifySeverity(peakImpact);
                console.log('[FallDetector] Fall burst detected:', {
                    peakImpact: peakImpact.toFixed(2),
                    samplesInWindow,
                    severity,
                });

                this.onFallDetected({
                    impact: peakImpact,
                    severity,
                });

                // Reset window after a confirmed fall
                this.recentImpacts = [];
            }
        }

        this.lastAccel = { x, y, z };
    };

    private classifySeverity(impact: number): FallEvent['severity'] {
        // Basic buckets based on approximate impact magnitude
        if (impact < 70) return 'light';
        if (impact < 100) return 'moderate';
        if (impact < 140) return 'severe';
        return 'critical';
    }
}

export const fallDetector = new FallDetector();
