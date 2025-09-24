let outputIp = 'unknown';
let fetched = false;

export async function fetchOutputIp(): Promise<string> {
  if (!fetched) {
    fetched = true;
    try {
      const res = await fetch('https://api.ipify.org');
      outputIp = await res.text();
    } catch (err) {
      // ignore errors, keep 'unknown'
    }
  }
  return outputIp;
}

export function getOutputIp(): string {
  return outputIp;
}
