// Inline SVG icon set — consistent 24px stroke icons, colored via currentColor.
// Replaces the emoji UI so the app reads as a designed product on every phone
// (emoji render differently per OS and look off-brand).

const PATHS = {
  home: '<path d="m3.5 10.2 8.5-6.7 8.5 6.7"/><path d="M5.5 8.8V20a1 1 0 0 0 1 1h11a1 1 0 0 0 1-1V8.8"/><path d="M9.75 21v-5.5h4.5V21"/>',
  box: '<path d="M21 16.2V7.8a1 1 0 0 0-.53-.88l-8-4.27a1 1 0 0 0-.94 0l-8 4.27a1 1 0 0 0-.53.88v8.4a1 1 0 0 0 .53.88l8 4.27a1 1 0 0 0 .94 0l8-4.27a1 1 0 0 0 .53-.88Z"/><path d="m3.3 7.3 8.7 4.7 8.7-4.7"/><path d="M12 12v9.3"/>',
  plus: '<path d="M12 5v14"/><path d="M5 12h14"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20.5 20.5-4.3-4.3"/>',
  chart: '<path d="M4 20.5h16"/><path d="M7 16.5v-4"/><path d="M12 16.5V7"/><path d="M17 16.5v-6.5"/>',
  settings: '<path d="M4 7.5h9"/><path d="M19.5 7.5h.5"/><circle cx="16" cy="7.5" r="2.2"/><path d="M4 16.5h.5"/><path d="M11 16.5h9"/><circle cx="8" cy="16.5" r="2.2"/>',
  camera: '<path d="M3 8.6A1.6 1.6 0 0 1 4.6 7h2.3l1.5-2.2a1.6 1.6 0 0 1 1.3-.7h4.6a1.6 1.6 0 0 1 1.3.7L17.1 7h2.3A1.6 1.6 0 0 1 21 8.6v9.8a1.6 1.6 0 0 1-1.6 1.6H4.6A1.6 1.6 0 0 1 3 18.4Z"/><circle cx="12" cy="13.2" r="3.4"/>',
  image: '<rect x="3" y="4.5" width="18" height="15" rx="2"/><circle cx="8.8" cy="10" r="1.6"/><path d="m4.5 19 5.2-5.2 2.8 2.8 3.4-3.4 3.6 3.6"/>',
  scan: '<path d="M4 7.5V5.8A1.8 1.8 0 0 1 5.8 4h1.7"/><path d="M16.5 4h1.7A1.8 1.8 0 0 1 20 5.8v1.7"/><path d="M20 16.5v1.7a1.8 1.8 0 0 1-1.8 1.8h-1.7"/><path d="M7.5 20H5.8A1.8 1.8 0 0 1 4 18.2v-1.7"/><path d="M8 9.5v5"/><path d="M11 9.5v5"/><path d="M13.8 9.5v5"/><path d="M16 9.5v5"/>',
  edit: '<path d="M4 20h4.2L19.4 8.8a2.12 2.12 0 0 0-3-3L5.2 17Z"/><path d="m13.8 6.4 3.8 3.8"/>',
  trash: '<path d="M4.5 7h15"/><path d="M9.5 7V5.5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1V7"/><path d="m6.2 7 .9 12.6a1 1 0 0 0 1 .9h7.8a1 1 0 0 0 1-.9L17.8 7"/><path d="M10 11v5.5"/><path d="M14 11v5.5"/>',
  check: '<path d="m4.5 12.8 4.7 4.7L19.5 6.3"/>',
  x: '<path d="m6 6 12 12"/><path d="M18 6 6 18"/>',
  copy: '<rect x="9" y="9" width="11.5" height="11.5" rx="2"/><path d="M5.5 15H4.8A1.8 1.8 0 0 1 3 13.2V4.8A1.8 1.8 0 0 1 4.8 3h8.4A1.8 1.8 0 0 1 15 4.8v.7"/>',
  cloud: '<path d="M17.3 18.5H7a4.3 4.3 0 0 1-.6-8.55 5.8 5.8 0 0 1 11.3 1.4 3.6 3.6 0 0 1-.4 7.15Z"/>',
  cloudCheck: '<path d="M17.3 18.5H7a4.3 4.3 0 0 1-.6-8.55 5.8 5.8 0 0 1 11.3 1.4 3.6 3.6 0 0 1-.4 7.15Z"/><path d="m9.3 13.2 2 2 3.6-4.2"/>',
  cloudOff: '<path d="M6.4 9.95A4.3 4.3 0 0 0 7 18.5h9.5"/><path d="M9 5.6a5.8 5.8 0 0 1 8.7 5.75 3.6 3.6 0 0 1 1.7 6"/><path d="m3.5 3.5 17 17"/>',
  cloudAlert: '<path d="M17.3 18.5H7a4.3 4.3 0 0 1-.6-8.55 5.8 5.8 0 0 1 11.3 1.4 3.6 3.6 0 0 1-.4 7.15Z"/><path d="M12 9.5v3.2"/><path d="M12 15.4h.01"/>',
  refresh: '<path d="M20 12a8 8 0 1 1-2.4-5.7"/><path d="M20 3.5V8h-4.5"/>',
  download: '<path d="M12 4v10.5"/><path d="m7.2 10.5 4.8 4.8 4.8-4.8"/><path d="M5 20h14"/>',
  upload: '<path d="M12 19.5V9"/><path d="m7.2 13 4.8-4.8 4.8 4.8"/><path d="M5 4h14"/>',
  dollar: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.2v9.6"/><path d="M14.4 9.3c-.45-.8-1.3-1.25-2.4-1.25-1.35 0-2.4.7-2.4 1.7 0 2.3 4.8 1.2 4.8 3.5 0 1-1.1 1.7-2.4 1.7-1.1 0-2-.45-2.4-1.25"/>',
  tag: '<path d="M3.5 3.5h7.2a1 1 0 0 1 .7.3l9 9a1 1 0 0 1 0 1.4l-6.2 6.2a1 1 0 0 1-1.4 0l-9-9a1 1 0 0 1-.3-.7Z"/><circle cx="8.2" cy="8.2" r="1.4"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M8 3v4"/><path d="M16 3v4"/><path d="M3.5 10.5h17"/>',
  external: '<path d="M14.5 4H20v5.5"/><path d="M20 4 11.5 12.5"/><path d="M18.5 13.5V18a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7.5a2 2 0 0 1 2-2h4.5"/>',
  sparkle: '<path d="m12 3.5 1.8 4.7 4.7 1.8-4.7 1.8L12 16.5l-1.8-4.7-4.7-1.8 4.7-1.8Z"/><path d="m18.5 15.5.85 2.15L21.5 18.5l-2.15.85-.85 2.15-.85-2.15-2.15-.85 2.15-.85Z"/>',
  bulb: '<path d="M9.2 17.5h5.6"/><path d="M10.2 20.5h3.6"/><path d="M12 3.5a5.7 5.7 0 0 1 3.4 10.3c-.6.45-.9 1-.9 1.7H9.5c0-.7-.3-1.25-.9-1.7A5.7 5.7 0 0 1 12 3.5Z"/>',
  alert: '<path d="M10.3 4.8 2.9 17.6a2 2 0 0 0 1.7 3h14.8a2 2 0 0 0 1.7-3L13.7 4.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9.5v4"/><path d="M12 16.9h.01"/>',
  receipt: '<path d="M5.5 3.5h13V20l-2.2-1.4-2.15 1.4-2.15-1.4L9.85 20l-2.15-1.4L5.5 20Z"/><path d="M9 8.5h6"/><path d="M9 12.5h6"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3.2 1.9"/>',
  chevron: '<path d="m9.5 5.5 6.5 6.5-6.5 6.5"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5"/><path d="M12 7.8h.01"/>',
  activity: '<path d="M3 12.5h3.5L9 6l5 12.5 2.5-6H21"/>',
  pin: '<path d="M12 21s-6.5-5.4-6.5-10.3a6.5 6.5 0 0 1 13 0C18.5 15.6 12 21 12 21Z"/><circle cx="12" cy="10.5" r="2.3"/>',
  flip: '<path d="M3.8 12a8.2 8.2 0 0 1 13.9-5.9"/><path d="M17.7 2.6v3.5h-3.5"/><path d="M20.2 12a8.2 8.2 0 0 1-13.9 5.9"/><path d="M6.3 21.4v-3.5h3.5"/><path d="M12 8.3v7.4"/><path d="M13.9 9.9c-.35-.6-1-.95-1.9-.95-1.05 0-1.9.55-1.9 1.35 0 1.8 3.8.95 3.8 2.75 0 .8-.85 1.35-1.9 1.35-.9 0-1.55-.35-1.9-.95"/>',
};

export function icon(name, cls = "") {
  const path = PATHS[name] || PATHS.info;
  return `<svg class="ic${cls ? " " + cls : ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${path}</svg>`;
}
