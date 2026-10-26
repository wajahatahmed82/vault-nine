// Street-level proof shots along the mission routes (graphics prompt 2,
// Phase 3 acceptance: "no plain boxes within 30 m of the mission routes").
//
// One frame per waypoint of the town walk route and the mission 2 route,
// standing at the waypoint and looking at the next one, through
// tools/views.js (HIGH preset, 1280x720, needs tools/shotsrv.js on 5179).
//
//   const s = await import('/tools/routeshots.js'); await s.capture(__rs, 'route')

import { capture as views } from './views.js';

const TOWN = [
  ['car park', 0, 34], ['south gate', 0, 44], ['station road', 0, 75], ['ridge junction', 0, 110],
  ['main street', 0, 150], ['square', 20, 192], ['town hall street', 50, 192], ['main south', 0, 230],
  ['main end', 0, 300], ['main at 275', 0, 275], ['street 275 west', -50, 275], ['terrace street', -100, 275],
  ['west 3 street', -150, 220], ['ridge road west', -150, 110], ['ridge road east', 100, 110],
  ['east 3 street', 150, 200], ['between warehouses', 185, 190], ['back to street', 150, 190],
  ['east 3 street south', 150, 262], ['water tower yard', 168, 270],
];
const M2 = [
  ['ridge junction', 0, 108], ['pharmacy front', 8, 122], ['ridge road west', -150, 108], ['west 2 street', -100, 110],
  ['terraces corner', -100, 222], ['street 220 east', 100, 220], ['east 3 at 220', 150, 220], ['jammer yard', 147.2, 150],
  ['ridge road east', 150, 112], ['petrol forecourt', -10, 112], ['main street', 0, 194], ['main south', 0, 286],
  ['roadblock pavement', 8.2, 316],
];

export function routeViews() {
  const out = {};
  for (const [tag, list] of [['t', TOWN], ['m', M2]]) {
    for (let i = 0; i < list.length - 1; i++) {
      const [name, x, z] = list[i], [, nx, nz] = list[i + 1];
      // stand a little short of the waypoint so the view is down the street
      const yaw = Math.atan2(-(nx - x), -(nz - z));
      out[`${tag}${String(i).padStart(2, '0')}_${name.replace(/\W+/g, '-')}`] = [x, z, yaw, -0.03];
    }
  }
  return out;
}

export function capture(rs, prefix = 'route', opts = {}) {
  return views(rs, prefix, { times: ['day'], views: routeViews(), ...opts });
}
