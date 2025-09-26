
export function wait10Seconds(): Promise<void> {
    return new Promise(resolve => {
        setTimeout(resolve, 10000);
    });
}
