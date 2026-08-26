export function stopCameraStream(stream: MediaStream | null) {
  if (!stream) return;
  for (const track of stream.getTracks()) track.stop();
}

export function selectableVideoDevices(items: MediaDeviceInfo[]): MediaDeviceInfo[] {
  const seenDeviceIds = new Set<string>();
  return items.filter((item) => {
    const deviceId = item.deviceId.trim();
    if (item.kind !== "videoinput" || !deviceId || seenDeviceIds.has(deviceId)) return false;
    seenDeviceIds.add(deviceId);
    return true;
  });
}
