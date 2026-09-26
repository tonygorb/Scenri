import { Link } from 'react-router';

/**
 * The record's way back. The wall's name is the link, then where this one
 * sits: Yours, Scenri library, or, for a product a store imported, From your
 * store. The same row on a presenter, a scene and a product, above the
 * identity, so the face stays with the name.
 */
export function RecordCrumb({ to, wall, where }: { to: string; wall: string; where: string }) {
  return (
    <div className="sc-lookpage-crumb">
      <Link to={to}>{wall}</Link>
      <span>/</span>
      <span>{where}</span>
    </div>
  );
}
