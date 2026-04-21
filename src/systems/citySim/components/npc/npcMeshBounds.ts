import { Box3, Mesh, Object3D, SkinnedMesh, Vector3 } from "three";

const _union = new Box3();
const _geomBox = new Box3();
const _size = new Vector3();
const _v = new Vector3();

/**
 * World-space max side length of the combined mesh AABBs (bind pose).
 */
export function getWorldBoundsMaxExtent(root: Object3D): number {
  root.updateMatrixWorld(true);
  _union.makeEmpty();
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      const g = obj.geometry;
      if (!g.boundingBox) g.computeBoundingBox();
      if (!g.boundingBox || g.boundingBox.isEmpty()) return;
      _geomBox.copy(g.boundingBox).applyMatrix4(obj.matrixWorld);
      _union.union(_geomBox);
    }
  });
  if (_union.isEmpty()) return 0;
  _union.getSize(_size);
  return Math.max(_size.x, _size.y, _size.z);
}

/**
 * Max axis span of all skeleton bone world positions (robust for skinned FBX).
 */
export function getSkeletonMaxExtent(root: Object3D): number {
  let minX = Infinity,
    minY = Infinity,
    minZ = Infinity;
  let maxX = -Infinity,
    maxY = -Infinity,
    maxZ = -Infinity;
  let any = false;

  root.updateMatrixWorld(true);
  root.traverse((obj) => {
    if (!(obj instanceof SkinnedMesh) || !obj.skeleton) return;
    any = true;
    for (const bone of obj.skeleton.bones) {
      bone.getWorldPosition(_v);
      minX = Math.min(minX, _v.x);
      minY = Math.min(minY, _v.y);
      minZ = Math.min(minZ, _v.z);
      maxX = Math.max(maxX, _v.x);
      maxY = Math.max(maxY, _v.y);
      maxZ = Math.max(maxZ, _v.z);
    }
  });

  if (!any || !Number.isFinite(minX)) return 0;
  const dx = maxX - minX;
  const dy = maxY - minY;
  const dz = maxZ - minZ;
  return Math.max(dx, dy, dz);
}

/**
 * Many FBX exports use centimeters (e.g. ~165–200) while Three.js assumes meters.
 * Values clearly above human scale in "meters" are treated as cm.
 */
function rawExtentToMeters(raw: number): number {
  if (raw <= 0) return raw;
  if (raw > 8) return raw / 100;
  return raw;
}

/**
 * Single height in meters for normalizing NPC scale (mesh + skeleton, cm heuristic).
 */
export function getNpcHeightMeters(root: Object3D): number {
  const meshExt = getWorldBoundsMaxExtent(root);
  const skelExt = getSkeletonMaxExtent(root);
  const raw = Math.max(meshExt, skelExt);
  return rawExtentToMeters(raw);
}
