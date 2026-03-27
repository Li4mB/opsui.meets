export const DESKTOP_BREAKPOINTS = {
  mobileMax: 639,
  tabletMin: 640,
  desktopMin: 1024,
  wideDesktopMin: 1280,
} as const;

export const HOST_QUICK_ACTIONS = [
  "admit-next",
  "admit-all",
  "mute-all",
  "lock-room",
  "start-recording",
  "stop-recording",
  "launch-poll",
] as const;
