import { Buffer } from 'buffer';

if (typeof window !== 'undefined') {
    window.global = window;
    window.Buffer = Buffer;
    if (!window.process) {
        // @ts-ignore
        window.process = {
            env: { NODE_ENV: 'development' },
            nextTick: (fn: any) => setTimeout(fn, 0)
        };
    }
}
