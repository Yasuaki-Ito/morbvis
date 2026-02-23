import type { IsosurfaceMesh } from '../types';

/**
 * Export one or more IsosurfaceMesh objects to a binary STL file.
 */
export function exportSTL(meshes: IsosurfaceMesh[]): Blob {
  // Count total triangles
  let totalTriangles = 0;
  for (const m of meshes) {
    totalTriangles += m.indices.length / 3;
  }

  // Binary STL: 80-byte header + 4-byte triangle count + 50 bytes per triangle
  const bufferSize = 80 + 4 + totalTriangles * 50;
  const buffer = new ArrayBuffer(bufferSize);
  const view = new DataView(buffer);

  // Header (80 bytes) — fill with zeros (already default)
  const header = 'MOrbVis STL Export';
  for (let i = 0; i < header.length; i++) {
    view.setUint8(i, header.charCodeAt(i));
  }

  // Triangle count
  view.setUint32(80, totalTriangles, true);

  let offset = 84;

  for (const mesh of meshes) {
    const v = mesh.vertices;
    const idx = mesh.indices;
    const numTri = idx.length / 3;

    for (let t = 0; t < numTri; t++) {
      const i0 = idx[t * 3] * 3;
      const i1 = idx[t * 3 + 1] * 3;
      const i2 = idx[t * 3 + 2] * 3;

      // Vertex positions
      const ax = v[i0], ay = v[i0 + 1], az = v[i0 + 2];
      const bx = v[i1], by = v[i1 + 1], bz = v[i1 + 2];
      const cx = v[i2], cy = v[i2 + 1], cz = v[i2 + 2];

      // Compute face normal (cross product of edges)
      const e1x = bx - ax, e1y = by - ay, e1z = bz - az;
      const e2x = cx - ax, e2y = cy - ay, e2z = cz - az;
      let nx = e1y * e2z - e1z * e2y;
      let ny = e1z * e2x - e1x * e2z;
      let nz = e1x * e2y - e1y * e2x;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
      nx /= len; ny /= len; nz /= len;

      // Write: normal (3 floats), vertex1 (3 floats), vertex2, vertex3, attribute (2 bytes)
      view.setFloat32(offset, nx, true); offset += 4;
      view.setFloat32(offset, ny, true); offset += 4;
      view.setFloat32(offset, nz, true); offset += 4;

      view.setFloat32(offset, ax, true); offset += 4;
      view.setFloat32(offset, ay, true); offset += 4;
      view.setFloat32(offset, az, true); offset += 4;

      view.setFloat32(offset, bx, true); offset += 4;
      view.setFloat32(offset, by, true); offset += 4;
      view.setFloat32(offset, bz, true); offset += 4;

      view.setFloat32(offset, cx, true); offset += 4;
      view.setFloat32(offset, cy, true); offset += 4;
      view.setFloat32(offset, cz, true); offset += 4;

      view.setUint16(offset, 0, true); offset += 2; // attribute byte count
    }
  }

  return new Blob([buffer], { type: 'application/sla' });
}
