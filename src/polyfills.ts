import { Buffer } from 'buffer';

if (typeof window !== 'undefined') {
    (window as any).global = window;
    (window as any).Buffer = Buffer;
    if (!(window as any).process) {
        // @ts-ignore
        (window as any).process = {
            env: { NODE_ENV: 'development' },
            nextTick: (fn: any) => setTimeout(fn, 0)
        };
    }
}
