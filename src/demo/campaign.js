/**
 * Campaign-wide art direction and settings. A new campaign copies this file
 * and changes what it needs; maps read it through game.campaign and may
 * override parts of it (a Tiled map with a `foliage` property, or a code map
 * passing its own object to game.foliageFor()).
 */
export const CAMPAIGN = {
  id: 'hollowbrook',
  title: 'Hollowbrook',
  /**
   * Tree style, see engine/world/Trees.js:
   *   broadleaf: 'sprite' | 'clusters' | 'twigs'
   *   conifer:   'sprite' | 'layers'
   *   trunks:    '3d' | 'sprite'   (under sprite crowns)
   */
  foliage: { broadleaf: 'twigs', conifer: 'sprite', trunks: '3d' },
};
